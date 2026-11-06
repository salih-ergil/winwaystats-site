// Winway Partners paneli (winwaystats.com/partners). Tek sayfa, adres içi yönlendirme (#/ana-sayfa ...).
// Ekranlar veriyi `data` ve `api` üzerinden okur. Gerçek veri live.js'ten (Supabase) aynı biçimde gelir;
// adres ?ornek=1 ile açılınca örnek veri (sample.js) gösterilir.
import { buildSample } from './sample.js?v=4d1886482d';
import { createLive } from './live.js?v=aa238e159a';
import { loadCountries, picker, PICKER_CSS } from '/secim.js?v=db427b3a8e';

const W = window.WWP;
const s = W.s;
// Dil (Salih, 2026-11-02): uygulamadan ?dil= ile gelir; sayfa /partners/<dil>/ (Türkçe /partners/). Tarih, sayı, yüzde dile göre.
const LANG = W.lang || 'tr';
const LOCALES = { tr: 'tr-TR', en: 'en-GB', de: 'de-DE', ru: 'ru-RU', es: 'es-ES', fr: 'fr-FR', pt: 'pt-BR', it: 'it-IT', pl: 'pl-PL' };
const LOCALE = LOCALES[LANG] ?? 'tr-TR';
const langPath = (l) => `/partners/${l === 'tr' ? '' : `${l}/`}`;
const DAY = 86400000;
const SAMPLE = !W.url || new URLSearchParams(location.search).has('ornek');
const live = SAMPLE ? null : createLive(W);
const EMPTY = () => ({ now: Date.now(), joined: Date.now(), prices: {}, users: [], commissions: [], clicks: [], campaigns: [], payouts: [], repTiers: [], flags: [], reps: [], profile: {} });
let data = SAMPLE ? buildSample() : EMPTY();
// Gerçek modda oturum aşaması: loading | login | mfa | closed | apply | review | panel
let stage = SAMPLE ? 'panel' : 'loading';
let me = SAMPLE ? { settings: { default_rate: 0.1 } } : null;
let admin = SAMPLE ? data.adminSample : null;
let mfa = { factorId: null, qr: null, secret: null };
document.querySelectorAll('link[media="print"]').forEach((l) => (l.media = 'all')); // yazı tipi sayfayı bekletmez
let captchaToken = null;
const openCards = new Set(); // açık başvuru kartları
const repDetails = {}; // açılan temsilcilik başvurusu metinleri (sadece bellekte)
let lockDoneFlag = false;
const revealed = {}; // yöneticinin açtığı şifreli alanlar (sadece bellekte)
let forgot = null; // şifre sıfırlama adımı: { step: 'email' | 'code' | 'totp' | 'new', email, factorId }
const app = document.getElementById('app');
document.head.insertAdjacentHTML('beforeend', `<style>${PICKER_CSS}</style>`);

// ---- Durum ----
const state = {
  period: 'thisMonth',
  currency: 'TRY',
  chart: 'earnings',
  hidden: new Set(),
  usersTab: 'new',
  payoutTab: 'status',
  filters: { campaign: '', status: '', country: '', q: '' },
  lastCreated: null,
  usersLimit: 50,
};

// Önizleme kuru (gösterim için): 1 USD / 1 EUR kaç TL
// Gösterim kuru (1 USD / 1 EUR kaç TL). Gerçek modda sunucudaki günlük kur (Avrupa Merkez Bankası) ile güncellenir.
const FX = { TRY: 1, USD: 42.1, EUR: 48.9 };

// ---- Yardımcılar ----
const esc = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const fmt = (str, vars) => str.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? '');
const money = (tl, currency = state.currency) =>
  new Intl.NumberFormat(LOCALE, { style: 'currency', currency, currencyDisplay: 'narrowSymbol', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(tl / FX[currency]);
const int = (v) => new Intl.NumberFormat(LOCALE).format(v);
const pct = (v) => new Intl.NumberFormat(LOCALE, { style: 'percent', maximumFractionDigits: 1 }).format(v);
const date = (t) => new Date(t).toLocaleDateString(LOCALE, { day: '2-digit', month: '2-digit', year: 'numeric' });
const longDate = (t) => new Date(t).toLocaleDateString(LOCALE, { day: 'numeric', month: 'long', year: 'numeric' });
const startOfDay = (t) => {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};
const sum = (arr, f) => arr.reduce((a, x) => a + f(x), 0);
const planLabel = (product) => {
  const p = data.prices[product];
  if (p) return `${s.plans[p.plan]} ${s.periodsShort[p.period]}`;
  return product ? s.plans[product] ?? product : '–';
};
const userStatus = (u) => (!u.product ? 'free' : u.cancelAt ? 'cancelled' : 'active');
const countryName = (code) => {
  try {
    return new Intl.DisplayNames([LANG], { type: 'region' }).of(code);
  } catch {
    return code;
  }
};

function periodRange(key, now = data.now) {
  const today = startOfDay(now);
  const d = new Date(today);
  switch (key) {
    case 'today':
      return [today, now];
    case 'yesterday':
      return [today - DAY, today - 1];
    case 'last7':
      return [today - 6 * DAY, now];
    case 'thisMonth':
      d.setDate(1);
      return [d.getTime(), now];
    case 'lastMonth': {
      d.setDate(1);
      const end = d.getTime() - 1;
      d.setMonth(d.getMonth() - 1);
      return [d.getTime(), end];
    }
    case 'last90':
      return [today - 89 * DAY, now];
    default:
      return [data.joined, now];
  }
}
const inRange = (t, [a, b]) => t >= a && t <= b;

// ---- Veri kapısı (önizlemede örnek veriden) ----
const api = {
  balances() {
    const live = (data.allLedger ?? data.commissions).filter((c) => c.status !== 'refunded');
    return {
      available: sum(live.filter((c) => c.status === 'available'), (c) => c.amount),
      pending: sum(live.filter((c) => c.status === 'pending'), (c) => c.amount),
    };
  },
  earnings(range) {
    return sum(data.commissions.filter((c) => c.status !== 'refunded' && inRange(c.at, range)), (c) => c.amount);
  },
  summary(range) {
    const clicks = sum(data.clicks.filter((c) => inRange(c.day, range)), (c) => c.n);
    const signups = data.users.filter((u) => inRange(u.registeredAt, range));
    const newSubs = data.users.filter((u) => u.subStart && inRange(u.subStart, range));
    const cancels = data.users.filter((u) => u.cancelAt && inRange(u.cancelAt, range));
    const pays = data.commissions.filter((c) => inRange(c.at, range));
    const live = pays.filter((c) => !c.refunded);
    const commission = sum(live, (c) => c.amount);
    const payingAccounts = new Set(live.map((c) => c.account)).size;
    return {
      clicks,
      signups: signups.length,
      signupRate: clicks ? signups.length / clicks : 0,
      newSubs: newSubs.length,
      subRate: signups.length ? signups.filter((u) => u.subStart).length / signups.length : 0,
      activeSubs: data.users.filter((u) => userStatus(u) === 'active').length,
      cancels: cancels.length,
      payments: live.length,
      company: sum(live, (c) => c.company),
      commission,
      perSub: payingAccounts ? commission / payingAccounts : 0,
      refunds: pays.length - live.length,
    };
  },
  chart(range, kind) {
    const [from, to] = range[1] - range[0] < 13 * DAY ? [startOfDay(data.now) - 13 * DAY, data.now] : range;
    const days = Math.ceil((to - from) / DAY);
    const step = days > 120 ? 7 : 1;
    const buckets = [];
    for (let t = startOfDay(from); t <= to; t += step * DAY) buckets.push({ t, a: 0, b: 0, c: 0 });
    const idx = (t) => Math.min(buckets.length - 1, Math.floor((startOfDay(t) - buckets[0].t) / (step * DAY)));
    if (kind === 'earnings') {
      for (const c of data.commissions) {
        if (c.refunded || c.at < buckets[0].t || c.at > to) continue;
        buckets[idx(c.at)].a += c.amount;
        buckets[idx(c.at)].b += c.company;
      }
    } else {
      for (const c of data.clicks) if (c.day >= buckets[0].t && c.day <= to) buckets[idx(c.day)].a += c.n;
      for (const u of data.users) {
        if (u.registeredAt >= buckets[0].t && u.registeredAt <= to) buckets[idx(u.registeredAt)].b += 1;
        if (u.subStart && u.subStart >= buckets[0].t && u.subStart <= to) buckets[idx(u.subStart)].c += 1;
      }
    }
    return { buckets, step, widened: range[1] - range[0] < 13 * DAY };
  },
  topUsers(range, n = 5) {
    if (data.live) return data.users.filter((u) => u.commission > 0).sort((a, b) => b.commission - a.commission).slice(0, n).map((u) => [u.account, u.commission]);
    const by = new Map();
    for (const c of data.commissions) if (!c.refunded && inRange(c.at, range)) by.set(c.account, (by.get(c.account) || 0) + c.amount);
    return [...by.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
  },
  users(filters) {
    const totals = new Map();
    for (const c of data.commissions) {
      if (c.refunded) continue;
      const t = totals.get(c.account) || { company: 0, amount: 0 };
      t.company += c.company;
      t.amount += c.amount;
      totals.set(c.account, t);
    }
    return data.users
      .filter((u) => !filters.campaign || u.campaign === filters.campaign)
      .filter((u) => !filters.status || userStatus(u) === filters.status)
      .filter((u) => !filters.country || u.country === filters.country)
      .filter((u) => !filters.q || u.account.includes(filters.q.trim()))
      .map((u) => ({ ...u, status: userStatus(u), ...(u.revenue != null ? { company: u.revenue, amount: u.commission } : totals.get(u.account) || { company: 0, amount: 0 }) }))
      .sort((a, b) => b.registeredAt - a.registeredAt);
  },
  campaigns(range) {
    return data.campaigns.map((c) => {
      const users = data.users.filter((u) => u.campaign === c.name);
      const pays = data.commissions.filter((x) => x.campaign === c.name && !x.refunded && inRange(x.at, range));
      const clicks = sum(data.clicks.filter((x) => x.campaign === c.name && inRange(x.day, range)), (x) => x.n);
      const signups = users.filter((u) => inRange(u.registeredAt, range)).length;
      return {
        ...c,
        link: `https://winwaystats.com/p/${c.code}`,
        clicks,
        signups,
        signupRate: clicks ? signups / clicks : 0,
        newSubs: users.filter((u) => u.subStart && inRange(u.subStart, range)).length,
        activeSubs: users.filter((u) => userStatus(u) === 'active').length,
        company: data.live ? sum(users, (u) => u.revenue) : sum(pays, (x) => x.company),
        commission: data.live ? sum(users, (u) => u.commission) : sum(pays, (x) => x.amount),
      };
    });
  },
  createCampaign(name) {
    const clean = name.trim().toLowerCase();
    if (!/^[a-z0-9ğüşıöç-]{3,30}$/.test(clean)) return { error: s.links.invalid };
    if (data.campaigns.some((c) => c.name === clean)) return { error: s.links.exists };
    const chars = 'ABCDEFGHJKLMNPRSTUVYZ23456789';
    let code;
    do code = `WW${Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('')}`;
    while (data.campaigns.some((c) => c.code === code));
    const c = { name: clean, code, createdAt: Date.now(), weight: 0 };
    data.campaigns.push(c);
    return { campaign: c };
  },
  payouts: () => [...data.payouts].sort((a, b) => b.at - a.at),
  profile: () => data.profile,
};

// ---- CSV ----
function downloadCsv(name, header, rows) {
  // Partnerin yazdığı metin Excel'de formül gibi çalışmasın (sayılar hariç)
  const safe = (t) => (/^[=+\-@\t\r]/.test(t) && !/^-?[\d.,\s]+$/.test(t) ? `'${t}` : t);
  const cell = (v) => `"${safe(String(v ?? '')).replace(/"/g, '""')}"`;
  const text = `﻿${[header, ...rows].map((r) => r.map(cell).join(';')).join('\r\n')}`;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

async function copy(text, btn) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const t = document.createElement('textarea');
    t.value = text;
    document.body.appendChild(t);
    t.select();
    document.execCommand('copy');
    t.remove();
  }
  const old = btn.textContent;
  btn.textContent = s.home.copied;
  setTimeout(() => (btn.textContent = old), 1500);
}

// ---- Grafik (SVG) ----
function chartSvg() {
  const range = periodRange(state.period);
  const { buckets, step, widened } = api.chart(range, state.chart);
  const series =
    state.chart === 'earnings'
      ? [
          { key: 'b', label: s.home.seriesCompany, cls: 'c2', money: true },
          { key: 'a', label: s.home.seriesCommission, cls: 'c1', money: true },
        ]
      : [
          { key: 'a', label: s.home.seriesClicks, cls: 'c3' },
          { key: 'b', label: s.home.seriesSignups, cls: 'c2' },
          { key: 'c', label: s.home.seriesSubs, cls: 'c1' },
        ];
  const shown = series.filter((x) => !state.hidden.has(`${state.chart}:${x.key}`));
  const narrow = window.innerWidth < 600;
  const Wd = narrow ? 420 : 800;
  const H = narrow ? 260 : 240;
  const L = narrow ? 44 : 64;
  const B = 28;
  const max = Math.max(1, ...shown.flatMap((x) => buckets.map((b) => (x.money ? b[x.key] / FX[state.currency] : b[x.key]))));
  const nice = (() => {
    const p = 10 ** Math.floor(Math.log10(max));
    return Math.ceil(max / p) * p;
  })();
  const x = (i) => L + (buckets.length === 1 ? 0 : (i * (Wd - L - 12)) / (buckets.length - 1));
  const y = (v) => 10 + (H - B - 10) * (1 - v / nice);
  // Kısa eksen etiketi her dilde aynı biçimde (8,8K / 1,2M): dilin kendi kısaltması (ör. Rusça "тыс.") sol kenara sığmıyordu
  const short = (v) => {
    const one = (n) => new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 1 }).format(n);
    return v >= 1e6 ? `${one(v / 1e6)}M` : v >= 1e3 ? `${one(v / 1e3)}K` : int(Math.round(v));
  };
  const fmtTick = (v) => (series[0].money ? short(v) : int(Math.round(v)));
  const grid = [0, 0.25, 0.5, 0.75, 1]
    .map((f) => `<line x1="${L}" x2="${Wd - 8}" y1="${y(nice * f)}" y2="${y(nice * f)}" class="grid"/><text x="${L - 8}" y="${y(nice * f) + 4}" class="tick" text-anchor="end">${esc(fmtTick(nice * f))}</text>`)
    .join('');
  const every = Math.max(1, Math.ceil(buckets.length / (narrow ? 4 : 7)));
  const xl = buckets
    .map((b, i) => (i % every === 0 ? `<text x="${x(i)}" y="${H - 6}" class="tick" text-anchor="middle">${new Date(b.t).toLocaleDateString(LOCALE, { day: '2-digit', month: '2-digit' })}</text>` : ''))
    .join('');
  const lines = shown
    .map((sr) => {
      const pts = buckets.map((b, i) => `${x(i).toFixed(1)},${y(sr.money ? b[sr.key] / FX[state.currency] : b[sr.key]).toFixed(1)}`).join(' ');
      const dots = buckets.length <= 31 ? buckets.map((b, i) => `<circle cx="${x(i)}" cy="${y(sr.money ? b[sr.key] / FX[state.currency] : b[sr.key])}" r="3" class="${sr.cls}"><title>${esc(`${new Date(b.t).toLocaleDateString(LOCALE)} · ${sr.label}: ${sr.money ? money(b[sr.key]) : int(b[sr.key])}`)}</title></circle>`).join('') : '';
      return `<polyline points="${pts}" class="line ${sr.cls}"/>${dots}`;
    })
    .join('');
  const legend = series
    .map((sr) => {
      const off = state.hidden.has(`${state.chart}:${sr.key}`);
      return `<button type="button" class="legend ${sr.cls}${off ? ' off' : ''}" data-series="${sr.key}"><i></i>${esc(sr.label)}</button>`;
    })
    .join('');
  const note = widened ? s.chart.last14 : step === 7 ? s.chart.weekly : s.chart.daily;
  return `<div class="pp-legend">${legend}<span class="muted small">${note}</span></div>
<svg viewBox="0 0 ${Wd} ${H}" class="pp-chart" role="img" aria-label="${esc(state.chart === 'earnings' ? s.home.chartEarnings : s.home.chartConversions)}">${grid}${xl}${lines}</svg>`;
}

// ---- Parçalar ----
const card = (title, value, sub, cls = '') => `<div class="pp-kpi ${cls}"><span>${esc(title)}</span><b>${value}</b>${sub ? `<small>${sub}</small>` : ''}</div>`;
const table = (cols, rows, empty) =>
  rows.length
    ? `<div class="pp-table"><table><thead><tr>${cols.map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`
    : `<p class="pp-empty">${esc(empty || s.common.empty)}</p>`;
const statusPill = (st) => `<span class="pill ${st}">${esc(s.reports.status[st])}</span>`;

// Bağlantı ve partner kodu aynı kampanyadan çıkar: bağlantı Android'de kendiliğinden tanınır, kod kayıtta elle yazılır
function linkBox() {
  const created = state.lastCreated;
  const link = created ? `https://winwaystats.com/p/${created.code}` : '';
  const code = created ? created.code : '';
  const copyRow = (v) => `<div class="pp-copy"><input readonly value="${esc(v)}" placeholder="–"><button type="button" class="secondary" data-copy="${esc(v)}" ${v ? '' : 'disabled'}>${esc(s.home.copy)}</button></div>`;
  return `<section class="pp-card">
  <h3>${esc(s.home.getLink)}</h3>
  <form class="pp-inline" data-create="link">
    <label>${esc(s.home.campaign)}<input name="name" placeholder="${esc(s.links.placeholder)}" maxlength="30"></label>
    <button type="submit">${esc(s.home.create)}</button>
  </form>
  <div class="msg" data-msg="link"></div>
  <label>${esc(s.home.link)}</label>${copyRow(link)}
  <label>${esc(s.home.code)}</label>${copyRow(code)}
  <p class="muted small">${esc(s.home.codeNote)}</p>
</section>`;
}

// ---- Ekranlar ----
function homeScreen() {
  const range = periodRange(state.period);
  const b = api.balances();
  const yesterday = api.earnings(periodRange('yesterday'));
  const month = api.earnings(periodRange('thisMonth'));
  const last = api.earnings(periodRange('lastMonth'));
  const total = api.earnings(periodRange('all'));
  const sm = api.summary(range);
  const top = api.topUsers(range);
  const monthName = (t) => new Date(t).toLocaleDateString(LOCALE, { month: 'long' });
  return `<div class="pp-kpis">
  ${card(s.home.available, money(b.available), esc(fmt(s.home.pending, { v: money(b.pending) })), 'main')}
  ${card(s.home.yesterday, money(yesterday), date(data.now - DAY))}
  ${card(s.home.thisMonth, money(month), esc(monthName(data.now)))}
  ${card(s.home.lastMonth, money(last), esc(monthName(periodRange('lastMonth')[0])))}
  ${card(s.home.total, money(total), esc(s.home.totalSub))}
</div>
<p class="muted small">${esc(fmt(s.home.nextPayout, { d: longDate(data.nextPayout) }))}</p>
<section class="pp-card">
  <div class="pp-seg" role="tablist">
    <button type="button" data-chart="earnings" class="${state.chart === 'earnings' ? 'on' : ''}">${esc(s.home.chartEarnings)}</button>
    <button type="button" data-chart="conversions" class="${state.chart === 'conversions' ? 'on' : ''}">${esc(s.home.chartConversions)}</button>
  </div>
  <div id="chart">${chartSvg()}</div>
</section>
<div class="pp-grid3">
  <section class="pp-card">
    <div class="pp-cardhead"><h3>${esc(s.home.users)}</h3>
      <div class="pp-seg small">
        <button type="button" data-users="new" class="${state.usersTab === 'new' ? 'on' : ''}">${esc(s.home.newUsers)}</button>
        <button type="button" data-users="active" class="${state.usersTab === 'active' ? 'on' : ''}">${esc(s.home.activeSubs)}</button>
      </div></div>
    <div class="pp-big">${int(state.usersTab === 'new' ? sm.signups : sm.activeSubs)}</div>
    <p class="muted small center">${esc(state.usersTab === 'new' ? `${s.home.inPeriod} · ${s.periods[state.period]}` : s.home.now)}</p>
  </section>
  <section class="pp-card">
    <h3>${esc(s.home.top)}</h3>
    ${top.length ? `<ol class="pp-toplist">${top.map(([acc, v]) => `<li><span>${esc(acc)}</span><b>${money(v)}</b></li>`).join('')}</ol>` : `<p class="pp-empty">${esc(s.common.empty)}</p>`}
  </section>
  ${linkBox()}
</div>
<div class="pp-grid2">${memberCard()}${myRepCard()}</div>`;
}

// Dosya adı için Türkçe harfler sadeleştirilir ("Kare gönderi" → "kare-gonderi")
const slug = (t) => t.toLocaleLowerCase('tr').replace(/ı/g, 'i').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
function svgToPng(svg, w, h, filename) {
  const img = new Image();
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  img.onload = () => {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    c.getContext('2d').drawImage(img, 0, 0, w, h);
    URL.revokeObjectURL(url);
    c.toBlob((blob) => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      a.click();
    }, 'image/png');
  };
  img.src = url;
}
// Kare kod (QR): kütüphane ilk ihtiyaçta yüklenir
let qrLib = null;
async function qrSvg(text, cell = 8) {
  qrLib ??= (await import('/partners/qrcode.mjs')).default;
  const q = qrLib(0, 'M');
  q.addData(text);
  q.make();
  const n = q.getModuleCount();
  const size = (n + 8) * cell;
  let rects = '';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c)) rects += `<rect x="${(c + 4) * cell}" y="${(r + 4) * cell}" width="${cell}" height="${cell}"/>`;
  return { svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><rect width="100%" height="100%" fill="#fff"/><g fill="#111">${rects}</g></svg>`, size };
}

function linksScreen() {
  const rows = api.campaigns(periodRange('all')).map((c) => [
    `<b>${esc(c.name)}</b>`,
    `<span class="pp-mono">${esc(c.link)}</span> <button type="button" class="secondary small" data-copy="${esc(c.link)}">${esc(s.home.copy)}</button>`,
    `<span class="pp-mono">${esc(c.code)}</span> <button type="button" class="secondary small" data-copy="${esc(c.code)}">${esc(s.home.copy)}</button>`,
    `<button type="button" class="secondary small" data-qr="${esc(c.link)}" data-qrname="${esc(c.name)}">${esc(s.links.qr)}</button>`,
    int(c.clicks),
    int(c.signups),
    int(c.newSubs),
    date(c.createdAt),
  ]);
  return `<p class="muted">${esc(s.links.intro)}</p>
<div class="pp-grid2">${linkBox()}</div>
<h2>${esc(s.links.listTitle)}</h2>
<p class="muted small">${esc(s.links.qrNote)}</p>
${table(s.links.cols, rows)}`;
}

function bannerSvg(w, h) {
  const sc = Math.min(w / 1080, h / 700);
  const f = (n) => Math.round(n * sc);
  const tall = h > w * 1.3;
  const pad = f(80);
  const titleSize = f(tall ? 76 : w > h ? 60 : 76);
  // Satırlara bölme: ortalama harf genişliği yazı boyunun ~0,56'sı
  const wrap = (text, size) => {
    const max = Math.floor((w - 2 * pad) / (size * 0.56));
    const out = [];
    for (const word of text.split(' ')) {
      const last = out[out.length - 1];
      if (last && `${last} ${word}`.length <= max) out[out.length - 1] = `${last} ${word}`;
      else out.push(word);
    }
    return out;
  };
  const lines = wrap(s.banners.headline, titleSize);
  const subSize = f(34);
  const subLines = wrap(s.banners.sub, subSize);
  const top = tall ? h * 0.32 : pad + f(150);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#1d211d"/><stop offset="1" stop-color="#1f3a22"/></linearGradient></defs>
<rect width="${w}" height="${h}" fill="url(#g)"/>
<circle cx="${w - f(120)}" cy="${f(140)}" r="${f(260)}" fill="#5cb85f" opacity="0.08"/>
<text x="${pad}" y="${pad + f(40)}" font-family="Red Hat Display, Arial, sans-serif" font-weight="700" font-size="${f(44)}" fill="#ffffff">Winway<tspan fill="#5cb85f">Stats</tspan></text>
${lines.map((l, i) => `<text x="${pad}" y="${top + i * titleSize * 1.15}" font-family="Red Hat Display, Arial, sans-serif" font-weight="700" font-size="${titleSize}" fill="#ffffff">${esc(l)}</text>`).join('')}
${subLines.map((l, i) => `<text x="${pad}" y="${top + lines.length * titleSize * 1.15 + f(30) + i * subSize * 1.3}" font-family="Red Hat Display, Arial, sans-serif" font-size="${subSize}" fill="#a0a6a0">${esc(l)}</text>`).join('')}
<rect x="${pad}" y="${h - pad - f(96)}" width="${f(470)}" height="${f(96)}" rx="${f(20)}" fill="#5cb85f"/>
<text x="${pad + f(235)}" y="${h - pad - f(36)}" text-anchor="middle" font-family="Red Hat Display, Arial, sans-serif" font-weight="700" font-size="${f(36)}" fill="#0f160f">${esc(s.banners.cta)}</text>
</svg>`;
}

function bannersScreen() {
  return `<p class="muted">${esc(s.banners.intro)}</p>
<div class="notice">${esc(s.banners.rules)}</div>
<div class="pp-banners">${s.banners.items
    .map(([name, size], i) => {
      const [w, h] = size.split(' × ').map(Number);
      return `<section class="pp-card"><h3>${esc(name)}</h3><p class="muted small">${esc(size)}</p><div class="pp-bimg">${bannerSvg(w, h)}</div><button type="button" class="secondary" data-banner="${i}">${esc(s.banners.download)}</button></section>`;
    })
    .join('')}</div>`;
}

function commissionScreen() {
  const r = Math.round(data.rate * 100);
  return `${table(s.commission.cols, [['TL', `<b>${pctRate(data.rate)}</b>`, date(data.joined), esc(fmt(s.commission.desc, { r })), s.commission.none]])}
<section class="pp-card"><h3>${esc(s.commission.rulesTitle)}</h3><ul class="pp-list">${s.commission.rules.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></section>`;
}

function payoutsScreen() {
  const b = api.balances();
  const p = api.profile();
  const ibanOk = data.now - p.ibanSince >= 7 * DAY;
  const minOk = b.available >= data.minPayout;
  const check = (ok, text) => `<li class="${ok ? 'ok' : 'no'}"><span>${ok ? '✓' : '–'}</span>${esc(text)}</li>`;
  const status = `<div class="pp-kpis two">
  ${card(s.payouts.next, longDate(data.nextPayout))}
  ${card(s.payouts.available, money(b.available), esc(`${s.payouts.min}: ${money(data.minPayout)}`), 'main')}
</div>
<section class="pp-card">
  <div class="pp-bar"><i style="width:${Math.min(100, (b.available / data.minPayout) * 100).toFixed(1)}%"></i></div>
  <p>${esc(minOk ? fmt(s.payouts.ready, { d: longDate(data.nextPayout) }) : fmt(s.payouts.progress, { v: money(data.minPayout - b.available) }))}</p>
  <h3>${esc(s.payouts.checks)}</h3>
  <ul class="pp-checks">
    ${check(ibanOk, s.payouts.checkIban)}${check(p.domestic, s.payouts.checkDomestic)}${check(p.status === 'active', s.payouts.checkActive)}${check(minOk, fmt(s.payouts.checkMin, { v: money(data.minPayout) }))}
  </ul>
</section>`;
  const list = api.payouts();
  const masked = p.iban;
  const pstat = (x) => (x.status && x.status !== 'paid' ? `<span class="pill ${x.status === 'cancelled' ? 'cancelled' : 'free'}">${esc(s.live.payoutStatus[x.status])}</span>` : `<span class="pill active">${esc(s.payouts.paid)}</span>`);
  const rows = list.map((x) => [date(x.at), `${date(x.periodFrom)} – ${date(x.periodTo)}`, `<b>${money(x.amount)}</b>`, esc(s.payouts.method), esc(masked), pstat(x)]);
  const history = `<div class="pp-actions"><button type="button" class="secondary" id="dl-payouts">${esc(s.payouts.download)}</button></div>${table(s.payouts.cols, rows, s.payouts.empty)}`;
  return `<div class="pp-seg">
  <button type="button" data-ptab="status" class="${state.payoutTab === 'status' ? 'on' : ''}">${esc(s.payouts.tabStatus)}</button>
  <button type="button" data-ptab="history" class="${state.payoutTab === 'history' ? 'on' : ''}">${esc(s.payouts.tabHistory)}</button>
</div>
${state.payoutTab === 'status' ? status : history}
<p class="muted small">${esc(s.payouts.info)}</p>`;
}

function summaryScreen() {
  const sm = api.summary(periodRange(state.period));
  const t = s.reports.tiles;
  const tiles = [
    [t.clicks, int(sm.clicks)],
    [t.signups, int(sm.signups)],
    [t.signupRate, pct(sm.signupRate)],
    [t.newSubs, int(sm.newSubs)],
    [t.subRate, pct(sm.subRate)],
    [t.activeSubs, int(sm.activeSubs)],
    [t.cancels, int(sm.cancels)],
    [t.payments, int(sm.payments)],
    [t.refunds, int(sm.refunds)],
    [t.company, money(sm.company)],
    [t.commission, money(sm.commission)],
    [t.perSub, money(sm.perSub)],
  ];
  return `<div class="pp-tiles">${tiles.map(([k, v]) => `<div class="pp-tile"><span>${esc(k)}</span><b>${v}</b></div>`).join('')}</div>`;
}

function campaignScreen() {
  const list = api.campaigns(periodRange(state.period));
  const rows = list.map((c) => [`<b>${esc(c.name)}</b>`, int(c.clicks), int(c.signups), pct(c.signupRate), int(c.newSubs), int(c.activeSubs), money(c.company), `<b>${money(c.commission)}</b>`]);
  rows.push([`<b>${esc(s.reports.total)}</b>`, int(sum(list, (c) => c.clicks)), int(sum(list, (c) => c.signups)), '', int(sum(list, (c) => c.newSubs)), int(sum(list, (c) => c.activeSubs)), money(sum(list, (c) => c.company)), `<b>${money(sum(list, (c) => c.commission))}</b>`]);
  return `<div class="pp-actions"><button type="button" class="secondary" id="dl-campaigns">${esc(s.reports.download)}</button></div>${table(s.reports.campaignCols, rows)}`;
}

function usersScreen() {
  const f = state.filters;
  const list = api.users(f);
  const countries = [...new Set(data.users.map((u) => u.country))].sort();
  const opt = (v, label, cur) => `<option value="${esc(v)}"${v === cur ? ' selected' : ''}>${esc(label)}</option>`;
  const rows = list.map((u) => [
    `<span class="pp-mono">${esc(u.account)}</span>`,
    esc(u.campaign),
    date(u.registeredAt),
    esc(countryName(u.country)),
    esc(planLabel(u.product)),
    statusPill(u.status),
    u.subStart ? date(u.subStart) : '–',
    u.cancelAt ? date(u.cancelAt) : '–',
    money(u.company),
    `<b>${money(u.amount)}</b>`,
    memberCell(u),
  ]);
  return `<p class="muted">${esc(s.reports.usersIntro)}</p>
<form class="pp-filters" id="ufilters">
  <input name="q" placeholder="${esc(s.reports.search)}" value="${esc(f.q)}" inputmode="numeric">
  <select name="campaign">${opt('', s.reports.allCampaigns, f.campaign)}${data.campaigns.map((c) => opt(c.name, c.name, f.campaign)).join('')}</select>
  <select name="status">${opt('', s.reports.allStatuses, f.status)}${['active', 'cancelled', 'free'].map((k) => opt(k, s.reports.status[k], f.status)).join('')}</select>
  <select name="country">${opt('', s.reports.allCountries, f.country)}${countries.map((c) => opt(c, countryName(c), f.country)).join('')}</select>
</form>
<div class="pp-actions"><span class="muted small">${esc(fmt(s.reports.shown, { n: int(list.length) }))}</span><button type="button" class="secondary" id="dl-users">${esc(s.reports.download)}</button></div>
${table(s.reports.userCols, rows.slice(0, state.usersLimit), s.reports.empty)}
${rows.length > state.usersLimit ? `<div class="pp-actions"><span></span><button type="button" class="secondary" id="more-users">${esc(fmt(s.reports.more, { n: int(Math.min(50, rows.length - state.usersLimit)) }))}</button></div>` : ''}`;
}

function profileScreen() {
  const p = api.profile();
  const row = (k, v) => `<div class="pp-row"><span>${esc(k)}</span><b>${v}</b></div>`;
  return `<div class="pp-grid2">
<section class="pp-card"><h3>${esc(s.profile.account)}</h3>
  ${row(s.profile.partnerId, esc(p.partnerId))}${row(s.profile.username, esc(p.username))}${row(s.profile.name, esc(p.fullName))}
  ${row(s.profile.email, `${esc(p.email)} <span class="pill active">${esc(s.profile.verified)}</span>`)}${row(s.profile.type, esc(s.profile.typePerson))}
  ${row(s.profile.country, esc(p.country))}
  <label>${esc(s.profile.language)}<select><option>Türkçe</option><option>English</option><option>Deutsch</option><option>Русский</option><option>Español</option><option>Français</option><option>Português</option><option>Italiano</option><option>Polski</option></select></label>
  <p class="muted small">${esc(s.profile.editNote)}</p>
</section>
<section class="pp-card"><h3>${esc(s.profile.payment)}</h3>
  ${row(s.profile.method, esc(s.payouts.method))}${row(p.swift ? s.apply.account : s.profile.iban, `<span class="pp-mono">${esc(p.iban)}</span>`)}${row(s.profile.holder, esc(p.holder))}${p.swift ? `${row(s.apply.bankName, esc(p.bankName))}${row(s.apply.bankCountry, esc(p.bankCountry))}${row(s.apply.swift, `<span class="pp-mono">${esc(p.swift)}</span>`)}` : ''}
  ${p.swift ? `<p class="muted small">${esc(s.live.errors.yurt_disi_hesap)}</p>` : `<button type="button" class="secondary" id="iban-btn">${esc(s.profile.changeIban)}</button>
  <p class="muted small" id="iban-msg">${esc(s.profile.ibanNote)}</p>`}
</section>
<section class="pp-card"><h3>${esc(s.apply.marketingTitle)}</h3>
  <label class="pp-check"><input type="checkbox" id="mkt-toggle"${p.marketing ? ' checked' : ''}> <span>${esc(s.apply.marketing)}</span></label>
  <p class="muted small" id="mkt-msg">${esc(s.apply.marketingNote)}</p>
</section>
<section class="pp-card"><h3>${esc(s.profile.security)}</h3>
  ${row(s.profile.twoFactor, `<span class="pill active">${esc(s.profile.on)}</span>`)}
  ${row(s.profile.contract, esc(fmt(s.profile.accepted, { d: date(p.contractAt), v: p.contractVersion })))}
</section>
</div>`;
}

function contactScreen() {
  return `<section class="pp-card"><p>${esc(s.contact.intro)}</p>
<div class="pp-row"><span>${esc(s.contact.email)}</span><b><a href="mailto:info@winway.com.tr">info@winway.com.tr</a></b></div>
<div class="pp-row"><span>${esc(s.contact.telegram)}</span><b><a href="https://t.me/WinwayStatss" target="_blank" rel="noopener">@WinwayStatss</a></b></div>
</section>`;
}

// ---- Üyelik ödemesi ----
function memberCard() {
  const m = s.member;
  const q = data.users.filter((u) => u.member === 'qualified').length;
  const t = data.users.filter((u) => u.member === 'tracking').length;
  return `<section class="pp-card"><h3>${esc(m.title)}</h3><p class="muted small">${esc(fmt(m.intro, { v: money(data.memberBonus) }))}</p>
  <div class="pp-row"><span>${esc(m.qualified)}</span><b>${int(q)}</b></div>
  <div class="pp-row"><span>${esc(m.tracking)}</span><b>${int(t)}</b></div>
  <div class="pp-row"><span>${esc(m.earned)}</span><b class="pp-green">${money(q * data.memberBonus)}</b></div>
  <details class="pp-faq"><summary>${esc(m.how)}</summary><ul class="pp-list small">${m.rules.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></details>
</section>`;
}
const memberCell = (u) => {
  const st = s.member.states[u.member];
  const cls = u.member === 'qualified' ? 'active' : u.member === 'tracking' ? 'free' : 'cancelled';
  return `<span class="pill ${cls}">${esc(st)}</span>${u.member === 'tracking' && u.activeDays != null ? `<br><small class="muted">${esc(fmt(s.member.progress, { d: u.activeDays, p: u.couponPeriods }))}</small>` : ''}`;
};

// ---- Partner Temsilcisi ----
const pctRate = (r) => new Intl.NumberFormat(LOCALE, { style: 'percent', maximumFractionDigits: 1 }).format(r);
function repTier(avg) {
  const tiers = data.repTiers;
  let i = 0;
  while (i + 1 < tiers.length && avg >= tiers[i + 1].from) i++;
  return { tier: tiers[i], next: tiers[i + 1] };
}

function myRepCard() {
  const m = data.myRep;
  const r = s.myRep;
  if (!m) return `<section class="pp-card"><h3>${esc(r.title)}</h3><p class="muted">${esc(s.live.noRep)}</p></section>`;
  return `<section class="pp-card"><h3>${esc(r.title)}</h3><p class="muted small">${esc(r.intro)}</p>
  <div class="pp-rep"><span class="pp-avatar">${esc(m.name.split(' ').map((x) => x[0]).join(''))}</span><div><b>${esc(m.name)}</b><small>${esc(fmt(r.since, { d: date(m.since) }))}</small></div></div>
  ${m.telegram ? `<div class="pp-row"><span>${esc(s.contact.telegram)}</span><b>${esc(m.telegram)}</b></div>` : ''}
  ${m.email ? `<div class="pp-row"><span>${esc(s.contact.email)}</span><b>${esc(m.email)}</b></div>` : ''}
  <p class="small">${esc(m.rated ? s.myRep.thanks : r.ask)}</p>
  <div class="pp-stars" id="stars">${[1, 2, 3, 4, 5].map((n) => `<button type="button" class="secondary small" data-star="${n}">${n}</button>`).join('')}</div>
  <div class="msg small" id="star-msg"></div>
  <button type="button" class="secondary small" id="rep-change">${esc(r.change)}</button>
</section>`;
}

function repScreen() {
  const r = s.rep;
  const rep = data.rep;
  const fromRate = rep.rate != null ? data.repTiers.findIndex((t) => Math.abs(t.rate - rep.rate) < 1e-6) : -1;
  const { tier, next } = fromRate >= 0 ? { tier: data.repTiers[fromRate], next: data.repTiers[fromRate + 1] } : repTier(rep.avg3);
  const share = (p) => p.monthShare ?? p.monthRevenue * tier.rate;
  const rows = rep.partners.map((p) => [
    `<b>${esc(p.name)}</b>`,
    esc(p.channel),
    `<span class="pill ${p.status === 'active' ? 'active' : 'free'}">${esc(r.status[p.status])}</span>`,
    esc(r.linked[p.linkedBy]),
    int(p.users),
    int(p.activeSubs),
    money(p.monthRevenue),
    `<b>${money(share(p))}</b>`,
    p.lastSignupAt ? date(p.lastSignupAt) : '–',
    p.no
      ? `<span class="pp-yn">${[true, false].map((v) => `<button type="button" class="small ${p.check && p.check.betting === v ? (v ? 'danger' : '') : 'secondary'}" data-chk="${esc(p.no)}" data-val="${v}">${esc(v ? r.yes : r.no)}</button>`).join('')}</span>${p.check ? '' : `<br><small class="muted">${esc(r.channelPending)}</small>`}`
      : '–',
  ]);
  const [m3, m2, m1, m0] = rep.shares ?? rep.history.map((v) => v * tier.rate);
  const inviteLink = rep.inviteCode ? `https://winwaystats.com/partners/#/basvuru?davet=${rep.inviteCode}` : '–';
  return `<p class="muted">${esc(r.intro)}</p>
<div class="pp-kpis">
  ${card(r.thisMonth, money(m0), esc(pctRate(tier.rate)), 'main')}
  ${card(r.lastMonth, money(m1))}
  ${card(r.total, money(m0 + m1 + m2 + m3))}
  ${card(r.partners, int(rep.partners.length))}
  ${card(r.activeSubs, int(rep.activeSubs))}
</div>
<div class="pp-grid2">
<section class="pp-card"><h3>${esc(r.tierTitle)}</h3>
  <div class="pp-big left">${esc(pctRate(tier.rate))}</div>
  <p>${esc(fmt(r.tierAvg, { n: int(rep.avg3) }))}</p>
  ${next ? `<div class="pp-bar"><i style="width:${Math.min(100, ((rep.avg3 - tier.from) / (next.from - tier.from)) * 100).toFixed(1)}%"></i></div><p class="small">${esc(fmt(r.tierNext, { r: pctRate(next.rate), n: int(next.from - rep.avg3) }))}</p>` : `<p class="small">${esc(r.tierTop)}</p>`}
  ${table(r.tierCols, data.repTiers.map((t, i) => [`${int(t.from)}${data.repTiers[i + 1] ? ` – ${int(data.repTiers[i + 1].from - 1)}` : '+'}`, t === tier ? `<b>${pctRate(t.rate)}</b> ←` : pctRate(t.rate)]))}
  <p class="muted small">${esc(r.tierRules)}</p>
</section>
<section class="pp-card"><h3>${esc(r.invite)}</h3><p class="muted small">${esc(r.inviteNote)}</p>
  <div class="pp-copy"><input readonly value="${esc(inviteLink)}"><button type="button" class="secondary" data-copy="${esc(inviteLink)}">${esc(s.home.copy)}</button></div>
</section>
</div>
<h2>${esc(r.listTitle)}</h2>
<p class="muted small">${esc(r.privacy)}</p>
${CHANNEL_CHECK_OPEN ? `<div class="notice"><b>${esc(r.channelTitle)}:</b> ${esc(r.channelText)}</div>` : ''}
${CHANNEL_CHECK_OPEN ? table(r.cols, rows) : table(r.cols.slice(0, -1), rows.map((x) => x.slice(0, -1)))}`;
}

function adminRepsScreen() {
  const a = s.admin;
  const ago = (t) => {
    const n = Math.floor((data.now - t) / DAY);
    return n < 1 ? a.today : fmt(a.daysAgo, { n });
  };
  const isActive = (x) => data.now - x.lastLogin <= 30 * DAY && (x.newPartners > 0 || x.activeRatio >= 0.5) && x.satisfaction >= 2;
  const warns = data.reps.filter((x) => !isActive(x) && (x.passiveDays || 0) > 60);
  const rows = data.reps.map((x) => {
    const act = isActive(x);
    return [
      `<b>${esc(x.name)}</b>`,
      `<span class="pill ${act ? 'active' : 'cancelled'}">${esc(act ? a.active : a.passive)}</span>${!act && x.passiveDays ? `<br><small class="muted">${esc(fmt(a.passiveFor, { n: x.passiveDays }))}</small>` : ''}`,
      int(x.partners),
      int(x.newPartners),
      pct(x.activeRatio),
      x.onboarding == null ? '–' : pct(x.onboarding),
      `<span class="${x.satisfaction < 2 ? 'pp-bad' : ''}">${new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 1 }).format(x.satisfaction)} / 5</span>`,
      `<span class="${data.now - x.lastLogin > 30 * DAY ? 'pp-bad' : ''}">${esc(ago(x.lastLogin))}</span>`,
      int(x.activeSubs),
      pctRate(repTier(x.activeSubs).tier.rate),
      esc(act && x.autoAssign ? a.on : a.off),
    ];
  });
  return `<p class="muted">${esc(a.intro)}</p>
${warns.map((x) => `<div class="notice">${esc(fmt(a.warn, { name: x.name }))} <button type="button" class="secondary small">${esc(a.transfer)}</button></div>`).join('')}
${table(a.cols, rows)}
<section class="pp-card"><h3>${esc(a.tiersTitle)}</h3>
${table(s.rep.tierCols, data.repTiers.map((t, i) => [`${int(t.from)}${data.repTiers[i + 1] ? ` – ${int(data.repTiers[i + 1].from - 1)}` : '+'}`, pctRate(t.rate)]))}
<p class="muted small">${esc(a.tiersNote)}</p></section>`;
}

function flagsScreen() {
  const f = s.flags;
  const stat = (k, v, bad) => `<div class="pp-row"><span>${esc(k)}</span><b class="${bad ? 'pp-bad' : ''}">${v}</b></div>`;
  if (!data.flags.length) return `<p class="muted">${esc(f.intro)}</p><p class="pp-empty">${esc(s.common.empty)}</p>`;
  return `<p class="muted">${esc(f.intro)}</p><p class="muted small">${esc(f.privacy)}</p>
${data.flags
  .map(
    (x) => `<section class="pp-card" data-flag="${x.id}">
  <div class="pp-cardhead"><h3>${esc(x.partner)}</h3><span class="muted small">${date(x.at)}${x.overdue ? ` · <span class="pp-bad">${esc(f.overdue)}</span>` : ''}</span></div>
  <p>${esc(f.kinds[x.kind] ?? x.kind)}</p>
  <div class="pp-grid2">${stat(f.members, int(x.members))}${stat(f.subRate, pct(x.subRate), x.subRate < 0.02)}${stat(f.sameDevice, int(x.sameDevice), x.sameDevice > 0)}${stat(f.pattern, pct(x.pattern), x.pattern > 0.7)}</div>
  ${stat(f.held, money(x.held))}
  ${x.decision ? `<p class="pill ${x.decision === 'genuine' ? 'active' : 'cancelled'}">${esc(s.live.decided[x.decision])}</p>${x.note ? `<p class="muted small">${esc(x.note)}</p>` : ''}` : `<label>${esc(f.note)}<textarea rows="2" data-note></textarea></label>
  <div class="pp-actions left"><button type="button" data-decide="genuine">${esc(f.genuine)}</button><button type="button" class="danger" data-decide="suspicious">${esc(f.suspicious)}</button></div>`}
  <div class="msg" data-fmsg></div>
</section>`,
  )
  .join('')}`;
}

// ---- Herkese açık sayfalar ----
// Tanıtım sayfası: örnek alınan affiliate sitelerinin bölüm düzeni, WinwayStats'ın dili ve tasarımıyla
const ICONS = {
  repeat: '<path d="M17 2l4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="M7 22l-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/>',
  user: '<circle cx="9" cy="7" r="4"/><path d="M3 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2"/><path d="M16 11l2 2 4-4"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="M21 15l-5-5L5 21"/>',
  headset: '<path d="M3 14v-3a9 9 0 0 1 18 0v3"/><path d="M21 16a2 2 0 0 1-2 2h-1v-6h1a2 2 0 0 1 2 2z"/><path d="M3 16a2 2 0 0 0 2 2h1v-6H5a2 2 0 0 0-2 2z"/><path d="M18 18v1a3 3 0 0 1-3 3h-3"/>',
  wallet: '<path d="M19 7V5a2 2 0 0 0-2-2H5a2 2 0 0 0 0 4h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5"/><path d="M17 14h.01"/>',
  chart: '<path d="M3 3v18h18"/><path d="M7 15l4-4 3 3 5-6"/>',
};
const icon = (k) => `<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[k] ?? ''}</svg>`;
const strip = (t, id) => `<h2 class="pp-strip" id="${id}"><span>${esc(t)}</span></h2>`;

function landingScreen() {
  const P = s.promo;
  const loginHref = SAMPLE ? '#/giris' : '#/giris';
  const applyHref = SAMPLE ? '#/basvuru' : '#/ulke';
  return `<section class="pp-hero2">
  <div class="pp-hero2-text">
    <span class="pp-kicker">${esc(P.kicker)}</span>
    <h1>${P.title.map((l, i) => `<span${i === 1 ? ' class="hl"' : ''}>${esc(l)}</span>`).join('')}</h1>
    <p class="pp-lead">${esc(P.lead)}</p>
    <div class="pp-actions left"><a class="btn" href="${applyHref}">${esc(P.apply)}</a><a class="btn secondary" href="${loginHref}">${esc(P.login)}</a>${me && !SAMPLE ? '' : `<a class="btn secondary" href="${kayitHref()}">${esc(P.createAccount)}</a>`}</div>
    ${me && !SAMPLE ? '' : `<p class="muted small">${esc(P.createHint)}</p>`}
  </div>
  <div class="pp-hero2-art" aria-hidden="true">
    <div class="pp-orb"><span>${esc(P.stats[0][0])}</span><small>${esc(P.stats[0][1])}</small></div>
    <div class="pp-orb two"><span>${esc(P.stats[1][0])}</span><small>${esc(P.stats[1][1])}</small></div>
  </div>
</section>
<div class="pp-statrow">${/* Kartlar: sadece Süresiz ve düzenli ödeme (Salih, 2026-11-02); %10 üstteki yuvarlakta, alt limit SSS'de */ [P.stats[1], P.stats[2]].map(([v, l]) => `<div><b>${esc(v)}</b><span>${esc(l)}</span></div>`).join('')}</div>

${strip(P.whyTitle, 'neden')}
<div class="pp-why">${P.why.map(([k, t, d]) => `<div class="pp-card pp-whycard"><span class="pp-icon">${icon(k)}</span><h3>${esc(t)}</h3><p class="muted">${esc(d)}</p></div>`).join('')}</div>

${strip(P.productTitle, 'urun')}
<p class="pp-center muted">${esc(P.productIntro)}</p>
<div class="pp-carousel">${P.product.map(([t, d], i) => `<div class="pp-card pp-slide"><span class="pp-num">${i + 1}</span><h3>${esc(t)}</h3><p class="muted">${esc(d)}</p></div>`).join('')}</div>

<section class="pp-card pp-verify">
  <div><h3>${esc(P.verifyTitle)}</h3><p class="muted">${esc(P.verifyText)}</p>
  <form id="verify-form" class="pp-inline"><label><input name="code" placeholder="${esc(P.verifyPlaceholder)}" maxlength="12" autocapitalize="characters"></label><button type="submit">${esc(P.verifyButton)}</button></form>
  <div class="msg" id="verify-msg"></div></div>
  <div class="pp-verify-badge" aria-hidden="true"><svg viewBox="0 0 24 24" width="64" height="64" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M9 12l2 2 4-4"/></svg></div>
</section>

${strip(P.howTitle, 'nasil')}
<div class="pp-steps four">${P.how.map(([t, d], i) => `<div class="pp-card"><span class="pp-num">${i + 1}</span><h3>${esc(t)}</h3><p class="muted">${esc(d)}</p></div>`).join('')}</div>

${strip(P.faqTitle, 'sss')}
<div class="pp-faqs">${P.faqs.map(([q, a]) => `<details class="pp-faq"><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join('')}</div>

<section class="pp-cta">
  <h2>${esc(P.ctaTitle)}</h2>
  <p class="muted">${esc(P.ctaText)}</p>
  <div class="pp-actions center"><a class="btn" href="${applyHref}">${esc(P.apply)}</a>${me && !SAMPLE ? '' : `<a class="btn secondary" href="${kayitHref()}">${esc(P.createAccount)}</a>`}</div>
  ${docsBlock()}
</section>`;
}

const validTckn = (v) => {
  if (!/^[1-9]\d{10}$/.test(v)) return false;
  const d = [...v].map(Number);
  const odd = d[0] + d[2] + d[4] + d[6] + d[8];
  const even = d[1] + d[3] + d[5] + d[7];
  return (((odd * 7 - even) % 10) + 10) % 10 === d[9] && (odd + even + d[9]) % 10 === d[10];
};

// Başvuru öncesi okunacak belgeler: giriş gerektirmez, açılır pencerede açılır
const docsBlock = () => `<p class="small pp-docs"><b>${esc(s.login.docsTitle)}:</b> <a href="#" data-legal="sozlesme">${esc(s.apply.contractLink)}</a> · <a href="#" data-legal="aydinlatma">${esc(s.apply.privacyLink)}</a></p>`;

// Şifre sıfırlama: e-posta → 6 haneli kod → (varsa) iki adımlı doğrulama → yeni şifre. Kod doğrulanınca oturum açılır;
// iki adımlı doğrulaması olan hesapta şifre ancak bu kod da girildikten sonra değişir.
function forgotScreen() {
  const r = s.login.reset;
  const back = `<p class="small"><a href="#" data-forgot="login">${esc(r.back)}</a></p>`;
  if (forgot.step === 'email') {
    return `<section class="pp-card pp-narrow"><h1>${esc(r.title)}</h1><p class="muted">${esc(r.intro)}</p>
<form id="forgot-email">
  <label>${esc(s.login.email)}<input name="email" type="email" autocomplete="email" value="${esc(forgot.email)}" required></label>
  ${SAMPLE ? '' : '<div id="captcha"></div>'}
  <button type="submit">${esc(r.send)}</button>
  <div class="msg" id="forgot-msg"></div>
</form>${back}</section>`;
  }
  if (forgot.step === 'code') {
    return `<section class="pp-card pp-narrow"><h1>${esc(r.codeTitle)}</h1><p class="muted">${esc(fmt(r.codeText, { email: forgot.email }))}</p>
<form id="forgot-code">
  <label>${esc(r.code)}<input name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" class="pp-code" required></label>
  <button type="submit">${esc(r.verify)}</button>
  <div class="msg" id="forgot-msg"></div>
</form><p class="small"><a href="#" data-forgot="email">${esc(r.resend)}</a></p>${back}</section>`;
  }
  if (forgot.step === 'totp') {
    return `<section class="pp-card pp-narrow"><h1>${esc(r.totpTitle)}</h1><p class="muted">${esc(s.live.verifyText)}</p>
<form id="forgot-totp">
  <label>${esc(s.twoFactor.code)}<input name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" class="pp-code" required></label>
  <button type="submit">${esc(r.verify)}</button>
  <div class="msg" id="forgot-msg"></div>
</form><p class="muted small">${esc(r.help)}</p></section>`;
  }
  return `<section class="pp-card pp-narrow"><h1>${esc(r.newTitle)}</h1><p class="muted">${esc(r.rules)}</p>
<form id="forgot-new">
  <label>${esc(r.password)}<input name="password" type="password" autocomplete="new-password" required></label>
  <label>${esc(r.password2)}<input name="password2" type="password" autocomplete="new-password" required></label>
  <button type="submit">${esc(r.save)}</button>
  <div class="msg" id="forgot-msg"></div>
</form></section>`;
}

function loginScreen() {
  if (forgot) return forgotScreen();
  const l = s.login;
  return `<section class="pp-card pp-narrow">${myCountry() ? `${legalBack('#/ulke')}${stepper(2)}` : ''}<h1>${esc(l.title)}</h1><p class="muted">${esc(l.intro)}</p>
<form id="login-form">
  <label>${esc(l.email)}<input name="email" type="email" autocomplete="email" required></label>
  <label>${esc(l.password)}<input name="password" type="password" autocomplete="current-password" required></label>
  ${SAMPLE ? '' : '<div id="captcha"></div>'}
  <button type="submit">${esc(l.submit)}</button>
  <div class="msg" id="login-msg"></div>
</form>
<p class="small"><a href="#" data-forgot="email">${esc(l.forgot)}</a></p>
<p class="small"><a href="${kayitHref()}">${esc(s.promo.noAccount)}</a></p>
${docsBlock()}
${SAMPLE ? `<div class="notice">${esc(l.preview)} <a href="#/ana-sayfa">${esc(l.toPanel)}</a></div>` : ''}</section>`;
}

function qrPlaceholder() {
  const r = (() => {
    let a = 7;
    return () => ((a = (a * 16807) % 2147483647) / 2147483647);
  })();
  const n = 21;
  let cells = '';
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) {
      const finder = (i < 7 && j < 7) || (i < 7 && j >= n - 7) || (i >= n - 7 && j < 7);
      const on = finder ? i % 6 === 0 || j % 6 === 0 || (i % 7 >= 2 && i % 7 <= 4 && j % 7 >= 2 && j % 7 <= 4) || (j >= n - 7 && (j - (n - 7)) % 6 === 0) || (i >= n - 7 && (i - (n - 7)) % 6 === 0) : r() > 0.55;
      if (on) cells += `<rect x="${j}" y="${i}" width="1" height="1"/>`;
    }
  return `<svg viewBox="-1 -1 ${n + 2} ${n + 2}" class="pp-qr"><rect x="-1" y="-1" width="${n + 2}" height="${n + 2}" fill="#fff"/><g fill="#111">${cells}</g></svg>`;
}

function twoFactorScreen() {
  const t = s.twoFactor;
  const enrolling = SAMPLE || mfa.qr;
  const qr = SAMPLE ? qrPlaceholder() : mfa.qr ? `<img class="pp-qr" src="${esc(mfa.qr)}" alt="QR">` : '';
  return `<section class="pp-card pp-narrow"><h1>${esc(enrolling && !SAMPLE ? s.live.enrollTitle : t.title)}</h1>
${enrolling ? `<p class="muted">${esc(SAMPLE ? t.setup : s.live.enrollText)}</p>${qr}${mfa.secret ? `<p class="muted small">${esc(s.live.secret)}<br><span class="pp-mono">${esc(mfa.secret)}</span></p>` : ''}` : `<p class="muted">${esc(s.live.verifyText)}</p>`}
<form id="tf-form">
  <label>${esc(t.code)}<input id="tf-code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="[0-9]*" class="pp-code"></label>
  <button type="submit">${esc(t.submit)}</button>
  <div class="msg" id="tf-msg"></div>
</form></section>`;
}

// ---- Başvuru sihirbazı (Salih, 2026-11-06): ülke → hesap → kişisel → kanal → ödeme → onay. Dil ve alanlar ülkeye göre ----
const COUNTRY_LANG = { TR: 'tr', KKTC: 'tr', DE: 'de', AT: 'de', CH: 'de', LI: 'de', RU: 'ru', BY: 'ru', KZ: 'ru', KG: 'ru', ES: 'es', MX: 'es', AR: 'es', CO: 'es', CL: 'es', PE: 'es', VE: 'es', EC: 'es', GT: 'es', CU: 'es', BO: 'es', DO: 'es', HN: 'es', PY: 'es', SV: 'es', NI: 'es', CR: 'es', PA: 'es', UY: 'es', FR: 'fr', BE: 'fr', LU: 'fr', MC: 'fr', SN: 'fr', CI: 'fr', ML: 'fr', BF: 'fr', NE: 'fr', TG: 'fr', BJ: 'fr', GA: 'fr', CD: 'fr', CG: 'fr', CM: 'fr', PT: 'pt', BR: 'pt', AO: 'pt', MZ: 'pt', CV: 'pt', IT: 'it', SM: 'it', VA: 'it', PL: 'pl' };
const IBAN_LEN = { AD: 24, AE: 23, AL: 28, AT: 20, AZ: 28, BA: 20, BE: 16, BG: 22, BH: 22, BR: 29, BY: 28, CH: 21, CR: 22, CY: 28, CZ: 24, DE: 22, DK: 18, DO: 28, EE: 20, EG: 29, ES: 24, FI: 18, FO: 18, FR: 27, GB: 22, GE: 22, GI: 23, GL: 18, GR: 27, GT: 28, HR: 21, HU: 28, IE: 22, IL: 23, IQ: 23, IS: 26, IT: 27, JO: 30, KW: 30, KZ: 20, LB: 28, LC: 32, LI: 21, LT: 20, LU: 20, LV: 21, LY: 25, MC: 27, MD: 24, ME: 22, MK: 19, MR: 27, MT: 31, MU: 30, NL: 18, NO: 15, PK: 24, PL: 28, PS: 29, PT: 25, QA: 29, RO: 24, RS: 22, SA: 24, SC: 31, SD: 18, SE: 24, SI: 19, SK: 24, SM: 27, ST: 25, SV: 28, TL: 23, TN: 24, TR: 26, UA: 29, VA: 22, VG: 24, XK: 20 };
// Yerel banka kodu isteyen ülkeler (uluslararası havalede gerekli; sunucu da aynı biçimi denetler)
const LOCAL_CODE = { US: { label: 'ABA routing number', re: /^\d{9}$/, max: 9 }, CA: { label: 'Transit + Institution', re: /^\d{8}$/, max: 8 }, AU: { label: 'BSB', re: /^\d{6}$/, max: 6 }, IN: { label: 'IFSC', re: /^[A-Z]{4}0[A-Z0-9]{6}$/, max: 11 } };
const validIban = (v) => {
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(v)) return false;
  let r = 0;
  for (const c of v.slice(4) + v.slice(0, 4)) r = /\d/.test(c) ? (r * 10 + Number(c)) % 97 : (r * 100 + c.charCodeAt(0) - 55) % 97;
  return r === 1;
};
const validVkn = (v) => {
  if (!/^\d{10}$/.test(v)) return false;
  let t = 0;
  for (let i = 0; i < 9; i++) {
    const x = (Number(v[i]) + 9 - i) % 10;
    t += x === 9 ? 9 : (x * 2 ** (9 - i)) % 9;
  }
  return (10 - (t % 10)) % 10 === Number(v[9]);
};
// Kanal bağlantıları: https:// yazılmadıysa eklenir. Sunucudaki _partner_kanal_gecerli ile aynı kural
const SOCIAL_HOME = /^https?:\/\/(www\.|m\.)?(t\.me|telegram\.me|instagram\.com|youtube\.com|youtu\.be|x\.com|twitter\.com|tiktok\.com|facebook\.com|twitch\.tv)\/?$/i;
const channelLinks = (v) => {
  const list = v.trim().split(/[\s,]+/).filter(Boolean).map((x) => (/^https?:\/\//i.test(x) ? x : `https://${x}`));
  const ok = list.length > 0 && v.length <= 1000 && list.every((x) => /^https?:\/\/([a-z0-9-]+\.)+[a-z]{2,}(\/\S*)?$/i.test(x) && !SOCIAL_HOME.test(x));
  return ok ? list.join('\n') : null;
};
const compact = (v) => v.replace(/[\s-]/g, '').toUpperCase();
// GDPR bilgilendirmesi gösterilen ülkeler: Avrupa Ekonomik Alanı, Birleşik Krallık, İsviçre
const GDPR_COUNTRIES = ['AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE', 'IS', 'LI', 'NO', 'GB', 'CH'];
const CHANNEL_CHECK_OPEN = false; // Temsilcinin aylık kanal bildirimi şimdilik kapalı (Salih, 2026-11-06); açılınca Ek-1'e madde döner
const STEP_COUNT = 6;
let applyStep = 1; // 1 kişisel, 2 kanal, 3 ödeme, 4 onay (genel sayaçta +2)
let applyDraft = {}; // sadece bellekte; tarayıcıya yazılmaz
const myCountry = () => {
  const c = load('wwp-ulke');
  return c && c !== 'null' ? c : ''; // eski sürüm "null" yazısı bırakmış olabilir
};
let lastCountry = ''; // "Değiştir" sonrası listede seçili gelir; aynı ülke seçilirse form korunur
const legalBack = (href) => `<p class="small pp-backlink"><a href="${href}">← ${esc(s.apply.wizard.back)}</a></p>`;
const kayitHref = () => {
  const q = new URLSearchParams({ partner: '1' });
  if (myCountry()) q.set('ulke', myCountry());
  return `/${LANG === 'tr' ? '' : `${LANG}/`}kayit/?${q}`;
};
const stepper = (n) => {
  const w = s.apply.wizard;
  return `<div class="pp-progress"><div class="pp-progress-text"><b>${esc(fmt(w.step, { n, t: STEP_COUNT }))}</b> · ${esc(w.steps[n - 1])}</div><div class="pp-progress-bar"><span style="width:${Math.round((n / STEP_COUNT) * 100)}%"></span></div></div>`;
};

function countryScreen() {
  const w = s.apply.wizard;
  return `<section class="pp-card pp-narrow">${legalBack('#/tanitim')}${stepper(1)}<h1>${esc(w.countryTitle)}</h1><p class="muted">${esc(w.countryIntro)}</p>
<div id="pk-start-country"></div>
<label class="pp-countrylang">${esc(w.langChoice)}<select id="country-lang">${Object.entries(W.langs ?? { tr: 'Türkçe' }).map(([k, v]) => `<option value="${k}"${k === LANG ? ' selected' : ''}>${esc(v)}</option>`).join('')}</select></label>
<div class="msg" id="country-msg"></div>
<div class="pp-actions left"><button type="button" id="country-next">${esc(w.next)}</button></div></section>`;
}

function applyScreen() {
  if (!SAMPLE && !myCountry()) return countryScreen();
  const a = s.apply;
  const w = a.wizard;
  const f = (label, input) => `<label>${esc(label)}${input}</label>`;
  const invite = new URLSearchParams(location.hash.split('?')[1] || '').get('davet') || '';
  const rejected = me?.partner?.status === 'rejected';
  const tr = (myCountry() || 'TR') === 'TR';
  const nav = (backAttr) => `<div class="pp-wizard-nav">${backAttr ? `<button type="button" class="secondary" ${backAttr}>${esc(w.back)}</button>` : ''}<button type="submit">${esc(w.next)}</button></div>`;
  return `<section class="pp-card pp-form">${stepper(applyStep + 2)}<h1>${esc(a.title)}</h1>
<p class="muted small"><span id="apply-country"></span> · <a href="#" id="country-change">${esc(w.change)}</a></p>
${rejected ? `<div class="notice">${esc(s.live.rejectedText)}${me.partner.reject_code && s.live.rejectReasons[me.partner.reject_code] && me.partner.reject_code !== 'diger' ? `<br><b>${esc(s.live.rejectReasonLabel)}:</b> ${esc(s.live.rejectReasons[me.partner.reject_code])}` : ''}${me.partner.reject_detail ? `<br><b>${esc(me.partner.reject_code === 'diger' ? s.live.rejectReasonLabel : s.live.rejectNoteLabel)}:</b> ${esc(me.partner.reject_detail)}` : ''}</div>` : ''}
<form id="apply-form" novalidate>
  <input type="hidden" name="invite_code" value="${esc(invite)}">
  <fieldset data-step="1" hidden>
    ${f(a.type, `<select name="entity_type"><option value="person">${esc(a.typePerson)}</option><option value="company">${esc(a.typeCompany)}</option></select>`)}
    <div id="company-fields" class="pp-fields" hidden>
      <p class="muted small">${esc(w.companyNote)}</p>
      <h3>${esc(w.companyTitle)}</h3>
      ${f(w.companyName, '<input name="company_name" autocomplete="organization">')}
      ${tr ? f(w.taxOffice, '<input name="tax_office">') : ''}
      ${f(tr ? w.taxNoTr : w.taxNoForeign, `<input name="tax_no" ${tr ? 'inputmode="numeric" maxlength="11"' : 'maxlength="30"'}>`)}
      ${f(tr ? w.regNoTr : w.regNoForeign, `<input name="company_reg_no" ${tr ? 'inputmode="numeric" maxlength="16"' : 'maxlength="30"'}>`)}
      ${f(w.companyAddress, `<textarea name="company_address" rows="2" placeholder="${esc(w.addressHint)}"></textarea>`)}
    </div>
    <h3 id="person-title">${esc(a.person)}</h3>
    <label><span id="name-label">${esc(a.fullName)}</span><input name="full_name" autocomplete="name"></label>
    <label>${esc(tr ? a.idNoTr : a.idNoForeign)}<input name="id_no" ${tr ? 'inputmode="numeric" maxlength="11"' : 'autocapitalize="characters" maxlength="30"'}></label>
    <div class="pp-field"><span>${esc(a.birth)}</span><div class="pp-dob"><select name="birth_day" aria-label="${esc(a.birthDay)}"></select><select name="birth_month" aria-label="${esc(a.birthMonth)}"></select><select name="birth_year" aria-label="${esc(a.birthYear)}"></select></div></div>
    <label>${esc(a.phone)}<span class="pp-phone"><span class="pp-dial" id="apply-dial"></span><input name="phone" type="tel" autocomplete="tel-national"></span></label>
    <label>${esc(a.address)}<textarea name="address" rows="2" placeholder="${esc(w.addressHint)}"></textarea></label>
    <div class="msg" data-step-msg></div>
    ${nav('data-back-country')}
  </fieldset>
  <fieldset data-step="2" hidden>
    <h3>${esc(a.channel)}</h3>
    ${f(a.channelLinks, '<textarea name="channel_links" rows="2" placeholder="https://t.me/..." autocapitalize="off" spellcheck="false"></textarea>')}
    <p class="muted small">${esc(w.channelHint)}</p>
    ${f(a.followers, '<input name="followers" inputmode="numeric" maxlength="9">')}
    <div class="msg" data-step-msg></div>
    ${nav('data-back')}
  </fieldset>
  <fieldset data-step="3" hidden>
    <h3>${esc(a.payment)}</h3>
    <p class="muted small">${esc(tr ? w.payTr : w.payForeign)}</p>
    ${f(a.holder, '<input name="holder" autocomplete="name">')}
    ${tr ? '' : `<div class="pp-field"><span>${esc(a.bankCountry)}</span><div id="pk-bank-country"></div></div>${f(a.bankName, '<input name="bank_name">')}${f(a.swift, '<input name="swift_bic" autocapitalize="characters" maxlength="11">')}<div id="code-field" hidden><label><span id="code-label"></span><input name="bank_code" autocapitalize="characters"></label></div>`}
    <label><span id="account-label">${esc(a.iban)}</span><input name="account" autocapitalize="characters" autocomplete="off" placeholder="${tr ? 'TR.. .... .... .... .... .... ..' : ''}"></label>
    <p class="muted small" id="account-hint"></p>
    ${tr ? '' : `<p class="muted small">${esc(a.foreignNote)}</p>`}
    <div class="msg" data-step-msg></div>
    ${nav('data-back')}
  </fieldset>
  <fieldset data-step="4" hidden>
    <h3>${esc(w.steps[5])}</h3>
    <p class="muted">${esc(w.review)}</p>
    <div id="apply-summary"></div>
    <label class="pp-check"><input type="checkbox" name="accept_age"> ${esc(a.age)}</label>
    <label class="pp-check"><input type="checkbox" name="accept_contract"> <span><a href="#" data-legal="sozlesme">${esc(a.contractLink)}</a>${esc(a.contractRest)}</span></label>
    <label class="pp-check"><input type="checkbox" name="accept_privacy"> <span><a href="#" data-legal="aydinlatma">${esc(a.privacyLink)}</a>${esc(a.privacyRest)}</span></label>
    <div class="pp-repbox"><label class="pp-check"><input type="checkbox" name="rep_info"> <span><b>${esc(a.rep.repCheck)}</b></span></label><div id="rep-info" hidden><p class="small"><b>${esc(a.rep.infoTitle)}</b><br>${esc(a.rep.info)}</p><p class="small muted">${esc(a.rep.infoMail)}</p></div></div>
    <label class="pp-check"><input type="checkbox" name="accept_marketing"> <span>${esc(a.marketing)}</span></label>
    ${GDPR_COUNTRIES.includes(myCountry()) ? `<p class="small">${esc(a.gdprRest)} <a href="#" data-legal="gdpr">${esc(a.gdprLink)}</a></p>` : ''}
    <p class="muted small">${esc(a.accuracy)}</p>
    <div class="msg" id="apply-msg" data-step-msg></div>
    <div class="pp-wizard-nav"><button type="button" class="secondary" data-back>${esc(w.back)}</button><button type="submit">${esc(a.submit)}</button></div>
  </fieldset>
</form></section>`;
}

// ---- Gerçek mod: durum ekranları ----
const stateScreen = (title, text) => `<section class="pp-card pp-narrow"><h1>${esc(title)}</h1>${text ? `<p class="muted">${esc(text)}</p>` : ''}</section>`;
const loadingScreen = () => stateScreen(s.live.loading, '');
const closedScreen = () => stateScreen(s.live.closedTitle, s.live.closedText);
const reviewScreen = () => `<section class="pp-card pp-narrow"><h1>${esc(s.live.reviewTitle)}</h1><p class="muted">${esc(fmt(s.live.reviewText, { no: me?.partner?.partner_no ?? '' }))}</p></section>`;
// Acil kilit: değişiklik e-postasındaki bağlantı; giriş gerektirmez. Bağlantı adres satırında sunucuya gitmeyen # bölümünde
function lockScreen() {
  const r = s.apply.rep;
  const t = new URLSearchParams(location.hash.split('?')[1] || '').get('t') || '';
  if (lockDoneFlag) return stateScreen(r.lockTitle, r.lockDone);
  if (!/^[a-f0-9]{64}$/.test(t)) return stateScreen(r.lockTitle, r.lockInvalid);
  return `<section class="pp-card pp-narrow"><h1>${esc(r.lockTitle)}</h1><p class="muted">${esc(r.lockText)}</p><div class="pp-actions left"><button type="button" class="danger" id="lock-btn">${esc(r.lockBtn)}</button></div><div class="msg" id="lock-msg"></div></section>`;
}
// Temsilcilik başvurusu: yeni hesap gerekmez, partner kaydına bağlıdır
function repApplyScreen() {
  const r = s.apply.rep;
  const a = me?.partner?.rep_application;
  const status = a?.status;
  const back = isPartner() ? '' : legalBackReview();
  if (me?.partner?.is_rep) return `<section class="pp-card pp-narrow"><h1>${esc(r.approvedTitle)}</h1><p class="muted">${esc(r.approvedText)}</p></section>`;
  if (status === 'pending') return `<section class="pp-card pp-narrow">${back}<h1>${esc(r.pendingTitle)}</h1><p class="muted">${esc(r.pendingText)}</p></section>`;
  if (status === 'auto_rejected') return `<section class="pp-card pp-narrow"><h1>${esc(r.rejectedTitle)}</h1><p class="muted">${esc(r.autoText)}</p></section>`;
  const prior = status === 'rejected' ? `<div class="notice"><b>${esc(r.rejectedTitle)}</b>${a.reject_code && a.reject_code !== 'diger' ? `<br>${esc(s.live.rejectReasonLabel)}: ${esc(r.reasons[a.reject_code] ?? '')}` : ''}${a.reject_detail ? `<br>${esc(a.reject_code === 'diger' ? s.live.rejectReasonLabel : s.live.rejectNoteLabel)}: ${esc(a.reject_detail)}` : ''}</div>` : '';
  // Form, ayrıntılı bilgi e-postası gittikten sonra açılır (e-postadaki düğme buraya gelir)
  if (!me?.partner?.rep_info_sent) {
    return `<section class="pp-card pp-narrow"><h1>${esc(r.requestTitle)}</h1>${prior}<p class="muted">${esc(r.info)}</p><p class="muted">${esc(r.requestText)}</p><div class="pp-actions left"><button type="button" class="secondary" id="rep-request">${esc(r.requestBtn)}</button></div><div class="msg" id="rep-request-msg"></div></section>`;
  }
  return `<section class="pp-card pp-form"><h1>${esc(r.formTitle)}</h1><p>${esc(r.formIntro)}</p>${prior}
<form id="rep-form" novalidate>
  <label>${esc(r.about)}<textarea name="about" rows="3" maxlength="1500" placeholder="${esc(r.aboutHint)}"></textarea></label>
  <label>${esc(r.experience)}<textarea name="experience" rows="3" maxlength="1500" placeholder="${esc(r.experienceHint)}"></textarea></label>
  <label>${esc(r.plan)}<textarea name="plan" rows="3" maxlength="1500" placeholder="${esc(r.planHint)}"></textarea></label>
  <label>${esc(r.hours)}<select name="hours"><option value="">${esc(r.hoursPick)}</option><option value="5">${esc(r.h5)}</option><option value="10">${esc(r.h10)}</option><option value="20">${esc(r.h20)}</option><option value="40">${esc(r.h40)}</option></select></label>
  <label class="pp-check"><input type="checkbox" name="accept"> <span><a href="#" data-legal="temsilci">${esc(r.acceptLink)}</a>${esc(r.acceptRest)}</span></label>
  <p class="muted small">${esc(r.calm)}</p>
  <div class="msg" id="rep-msg"></div>
  <button type="submit">${esc(r.submit)}</button>
</form></section>`;
}
const legalBackReview = () => `<p class="small pp-backlink"><a href="#/inceleniyor">← ${esc(s.apply.wizard.back)}</a></p>`;
// Sözleşme sürümü değişince yeniden onay (B5, 2026-11-02): onaylamadan panele geçilmez
const contractVersionNow = () => String(me?.settings?.contract_version ?? '');
const needsContract = () => !!me?.partner && isPartner() && !!contractVersionNow() && me.partner.contract_version !== contractVersionNow();
const contractScreen = () => {
  const v = contractVersionNow();
  return `<section class="pp-card pp-narrow"><h1>${esc(s.live.contractTitle)}</h1><p class="muted">${esc(fmt(s.live.contractText, { v }))}</p>
<label class="pp-check"><input type="checkbox" id="contract-ok"> <span><a href="#" data-legal="sozlesme">${esc(s.live.contractRead)}</a>${esc(fmt(s.live.contractCheck, { v }))}</span></label>
<div class="pp-actions left"><button type="button" id="contract-accept">${esc(s.live.contractButton)}</button></div><div class="msg" id="contract-msg"></div></section>`;
};
const errText = (e) => {
  const raw = String(e?.message ?? e ?? '');
  const key = Object.keys(s.live.errors).find((k) => raw.includes(k)) ?? (e?.code && s.live.errors[e.code] ? e.code : null);
  return key ? s.live.errors[key] : `${s.live.errors.generic} (${raw.slice(0, 80)})`;
};

// ---- Yönetici ekranları (gerçek veri) ----
// Oran seçimi: %5–%20 arası açılır liste (değer kesir olarak döner)
const rateSelect = (attr, current) => {
  const opts = Array.from({ length: 16 }, (_, i) => i + 5);
  const cur = Math.round(current * 100);
  if (!opts.includes(cur)) opts.push(cur);
  return `<select ${attr}>${opts.sort((a, b) => a - b).map((v) => `<option value="${v / 100}"${v === cur ? ' selected' : ''}>${pctRate(v / 100)}</option>`).join('')}</select>`;
};
// Başvurular (Salih, 2026-11-06): partner ve temsilcilik iki sekmede; aynı kişinin iki başvurusu birbirine bağlı
function adminApplicationsTabs() {
  const A = s.adminLive;
  const counts = { partner: (admin?.partners ?? []).filter((p) => p.status === 'application').length, rep: (admin?.repApps ?? []).filter((x) => x.status === 'pending').length };
  const tab = state.appTab === 'rep' ? 'rep' : 'partner';
  const btn = (k, label) => `<button type="button" role="tab" aria-selected="${tab === k}" class="${tab === k ? 'on' : ''}" data-app-tab="${k}">${esc(label)} (${counts[k]})</button>`;
  return `<div class="pp-seg" role="tablist">${btn('partner', A.appTabPartner)}${btn('rep', s.apply.rep.adminTitle)}</div>${tab === 'rep' ? adminRepAppsScreen() : adminApplicationsScreen()}`;
}

function adminApplicationsScreen() {
  const A = s.adminLive;
  const list = (admin?.partners ?? []).filter((p) => p.status === 'application');
  if (!list.length) return `<p class="pp-empty">${esc(A.noApplications)}</p>`;
  const row = (k, v) => `<div class="pp-row"><span>${esc(k)}</span><b>${v}</b></div>`;
  const age = (d) => (d ? Math.floor((Date.now() - Date.parse(d)) / (365.25 * DAY)) : '–');
  // Aynı kişinin ikinci hesabı: aynı IBAN, kimlik no ya da telefon başka bir partner kaydında var mı
  const norm = (v) => String(v ?? '').replace(/\s/g, '').toUpperCase();
  const dupes = (p) => {
    const out = [];
    for (const o of admin.partners) {
      if (o.id === p.id) continue;
      // Canlıda şifreli alanlar özetle karşılaştırılır; önizlemede örnek veri
      const hit = [['iban', norm(p.account?.iban_ozet ?? p.account?.iban), norm(o.account?.iban_ozet ?? o.account?.iban)], ['id_no', norm(p.priv.id_no_ozet ?? p.priv.id_no), norm(o.priv.id_no_ozet ?? o.priv.id_no)], ['phone', norm(p.priv.phone_ozet ?? p.priv.phone), norm(o.priv.phone_ozet ?? o.priv.phone)]].find(([, a, b]) => a && a === b);
      if (hit) out.push(fmt(A.duplicate, { what: A.dupWhat[hit[0]], who: `${o.priv.full_name || o.partner_no} · ${A.statuses[o.status]}` }));
    }
    return out;
  };
  return list
    .map((p) => {
      const v = p.priv;
      // Şifreli alanlar: yönetici "göster"e basınca (kayda geçer); önizlemede örnek veri
      const open = SAMPLE ? v : revealed[p.id];
      const hid = '••••';
      const d0 = dupes(p);
      // Aynı kişinin önceki başvuruları değişiklik kaydından sayılır
      const history = (admin.log ?? []).filter((l) => l.entity_id === p.id && l.entity === 'partners');
      const tries = history.filter((l) => l.after?.status === 'application' && l.before?.status !== 'application').length;
      const lastReject = history.find((l) => l.after?.status === 'rejected' && l.before?.status !== 'rejected');
      const hasRep = (admin.repApps ?? []).some((x) => x.partner_id === p.id && x.status === 'pending');
      return `<details class="pp-card pp-appcard" data-app="${p.id}" data-open-key="app-${p.id}"${openCards.has(`app-${p.id}`) ? ' open' : ''}>
  <summary><span><b>${esc(v.company_name || v.full_name || p.partner_no)}</b><br><span class="muted small">${esc(p.partner_no)} · ${date(Date.parse(p.created_at))} · ${esc(v.country || '–')} · ${esc(v.entity_type === 'company' ? s.apply.typeCompany : s.apply.typePerson)}</span></span>${tries > 1 ? `<span class="pill">${esc(fmt(A.reapply, { n: tries }))}</span>` : ''}${d0.length ? '<span class="pill cancelled">!</span>' : ''}</summary>
  ${d0.map((d) => `<div class="notice">${esc(d)}</div>`).join('')}
  ${lastReject ? `<div class="notice">${esc(fmt(A.reapplyPrev, { date: date(Date.parse(lastReject.at)) }))}${lastReject.after.reject_code && lastReject.after.reject_code !== 'diger' ? ` ${esc(s.live.rejectReasonLabel)}: ${esc(s.live.rejectReasons[lastReject.after.reject_code] ?? '')}` : ''}</div>` : ''}
  ${hasRep ? `<div class="notice">${esc(A.repAlso)} <button type="button" class="secondary small" data-app-tab="rep">${esc(A.repAlsoBtn)}</button></div>` : ''}
  <div class="pp-grid2">
    <div>${row(s.apply.idNo, esc(open ? open.id_no : hid))}${row(A.age, open ? esc(age(open.birth_date)) : hid)}${row(s.apply.phone, esc(open ? open.phone : hid))}${row(s.apply.country, esc(v.country))}${row(s.apply.address, esc(open ? open.address : hid))}</div>
    <div>${row(s.apply.type, esc(v.entity_type === 'company' ? s.apply.typeCompany : s.apply.typePerson))}${v.company_name ? `${row(s.apply.wizard.companyName, esc(v.company_name))}${v.tax_office ? row(s.apply.wizard.taxOffice, esc(v.tax_office)) : ''}${v.company_reg_no ? row(s.apply.wizard.regNoForeign, esc(v.company_reg_no)) : ''}${row(s.apply.wizard.companyAddress, open ? esc(open.company_address || '–') : hid)}` : ''}${row(s.apply.taxNo, open ? esc(open.tax_no || '–') : hid)}${row(s.apply.followers, esc(v.followers ?? '–'))}${row(s.apply.marketingTitle, esc(p.marketing_consent ? s.apply.marketingOn : s.apply.marketingOff))}${row(p.account?.swift_bic ? s.apply.account : s.apply.iban, `<span class="pp-mono">${esc(open?.iban ?? p.account?.iban ?? (p.account ? `•••• ${p.account.iban_son4}` : '–'))}</span>`)}${row(s.apply.holder, esc(p.account?.holder ?? '–'))}${p.account?.swift_bic ? `${row(s.apply.bankName, esc(p.account.bank_name ?? '–'))}${row(s.apply.bankCountry, esc(p.account.bank_country ?? '–'))}${row(s.apply.swift, `<span class="pp-mono">${esc(p.account.swift_bic)}</span>`)}` : ''}${p.rep_id ? row(A.invitedBy, esc(admin.name[p.rep_id] ?? '–')) : ''}</div>
  </div>
  ${v.channel_links ? `<p class="small">${esc(v.channel_links)}</p>` : ''}
  ${open ? '' : `<div class="pp-actions left"><button type="button" class="secondary small" data-reveal="${esc(p.id)}">${esc(A.reveal)}</button></div><p class="muted small">${esc(A.revealNote)}</p>`}
  <div class="pp-actions left">${v.id_doc_path ? `<button type="button" class="secondary small" data-doc="${esc(v.id_doc_path)}">${esc(A.openDoc)}</button>` : ''}${v.id_doc_back_path ? `<button type="button" class="secondary small" data-doc="${esc(v.id_doc_back_path)}">${esc(A.openDocBack)}</button>` : ''}</div>
  <div class="pp-grid2 tight"><label>${esc(A.rate)}${rateSelect('data-rate', Number(me.settings?.default_rate ?? 0.1))}</label><label>${esc(A.note)}<input data-note></label></div>
  <h4 class="pp-sub">${esc(A.checklist)}</h4>
  ${A.checks.map((c, i) => `<label class="pp-check"><input type="checkbox" data-check="${i}"> <span>${esc(c)}</span></label>`).join('')}
  <div class="pp-grid2 tight" data-reject-box hidden><label>${esc(s.live.rejectReasonLabel)}<select data-reject><option value="">${esc(A.rejectPick)}</option>${Object.entries(s.live.rejectReasons).map(([k, t]) => `<option value="${k}">${esc(t)}</option>`).join('')}</select></label><label>${esc(A.rejectDetail)}<input data-reject-detail maxlength="300"></label></div>
  <div class="pp-actions left"><button type="button" data-decide-app="1">${esc(A.approve)}</button><button type="button" class="danger" data-decide-app="0">${esc(A.reject)}</button></div>
  <div class="msg" data-amsg></div>
</details>`;
    })
    .join('');
}

// Temsilcilik başvuruları (Salih, 2026-11-06): kart kart; açılınca şifreli metinler okunur ve kayda geçer
function adminRepAppsScreen() {
  const r = s.apply.rep;
  const A = s.adminLive;
  const list = (admin?.repApps ?? []).filter((x) => x.status === 'pending');
  if (!list.length) return `<p class="pp-empty">${esc(r.none)}</p>`;
  const row = (k, v) => `<div class="pp-row"><span>${esc(k)}</span><b>${v}</b></div>`;
  return list
    .map((x) => {
      const p = (admin.partners ?? []).find((o) => o.id === x.partner_id);
      const key = `rep-${x.id}`;
      const d = repDetails[x.id];
      const ok = p?.status === 'approved';
      return `<details class="pp-card pp-appcard" data-repapp="${x.id}" data-open-key="${key}"${openCards.has(key) ? ' open' : ''}>
  <summary><span><b>${esc(p?.priv?.company_name || p?.priv?.full_name || p?.partner_no || '–')}</b><br><span class="muted small">${esc(p?.partner_no ?? '')} · ${date(Date.parse(x.created_at))} · ${esc(A.statuses[p?.status] ?? p?.status ?? '')}</span></span></summary>
  ${row(r.partnerStatus, esc(A.statuses[p?.status] ?? p?.status ?? '–'))}${row(s.apply.country, esc(p?.priv?.country ? countryName(p.priv.country) : '–'))}${row(r.hours, esc(r[`h${x.hours_per_week}`] ?? x.hours_per_week ?? '–'))}
  ${d ? `<h4 class="pp-sub">${esc(r.about)}</h4><p class="small pp-pre">${esc(d.about ?? '–')}</p><h4 class="pp-sub">${esc(r.experience)}</h4><p class="small pp-pre">${esc(d.experience ?? '–')}</p><h4 class="pp-sub">${esc(r.plan)}</h4><p class="small pp-pre">${esc(d.plan)}</p>` : `<p class="muted small">${esc(A.revealNote)}</p>`}
  <div class="pp-actions left">${x.cv_path ? `<button type="button" class="secondary small" data-doc="${esc(x.cv_path)}">${esc(r.cvOpen)}</button>` : ''}</div>
  ${ok ? '' : `<div class="notice">${esc(r.needPartner)}</div>`}
  <div class="pp-grid2 tight" data-reject-box hidden><label>${esc(s.live.rejectReasonLabel)}<select data-reject><option value="">${esc(A.rejectPick)}</option>${Object.entries(r.reasons).map(([k, t]) => `<option value="${k}">${esc(t)}</option>`).join('')}</select></label><label>${esc(A.rejectDetail)}<input data-reject-detail maxlength="300"></label></div>
  <div class="pp-actions left"><button type="button" data-rep-decide="1"${ok ? '' : ' disabled'}>${esc(A.approve)}</button><button type="button" class="danger" data-rep-decide="0">${esc(A.reject)}</button></div>
  <div class="msg" data-amsg></div>
</details>`;
    })
    .join('');
}

// Yönetici işlem kaydından bir partnere ait son değişiklikler (alan: önce → sonra)
// Değişiklik kaydını yönetici için cümleye çevirir; kimlik, tarih gibi teknik alanlar gösterilmez
function logSentences(l) {
  const A = s.adminLive;
  const T = A.logText;
  if (l.entity === 'mfa_reset') return [T.mfa];
  if (!l.before) return [T.applied];
  const b = l.before;
  const n = l.after ?? {};
  const changed = (k) => JSON.stringify(b[k] ?? null) !== JSON.stringify(n[k] ?? null);
  const pct = (v) => (v == null ? '–' : pctRate(Number(v)));
  const out = [];
  if (changed('status')) out.push(fmt(T.status, { a: A.statuses[b.status] ?? b.status ?? '–', b: A.statuses[n.status] ?? n.status ?? '–' }));
  if (changed('reject_code') && n.reject_code && n.reject_code !== 'diger') out.push(fmt(T.reason, { x: s.live.rejectReasons[n.reject_code] ?? n.reject_code }));
  if (changed('reject_detail') && n.reject_detail) out.push(fmt(n.reject_code === 'diger' ? T.reason : T.note, { x: n.reject_detail }));
  if (changed('rate')) out.push(fmt(T.rate, { a: pct(b.rate), b: pct(n.rate) }));
  if (changed('rep_rate')) out.push(fmt(T.repRate, { a: pct(b.rep_rate), b: pct(n.rep_rate) }));
  if (changed('is_rep')) out.push(n.is_rep ? T.repOn : T.repOff);
  if (changed('rep_id')) out.push(fmt(T.repOf, { x: n.rep_id ? admin?.name?.[n.rep_id] ?? '–' : '–' }));
  if (changed('marketing_consent')) out.push(n.marketing_consent ? T.consentOn : T.consentOff);
  if (changed('domestic')) out.push(n.domestic ? T.domesticOn : T.domesticOff);
  if (changed('contract_version') && n.contract_version) out.push(fmt(T.contract, { x: n.contract_version }));
  if (changed('admin_note')) out.push(T.adminNote);
  if (changed('trial')) out.push(n.trial ? T.trialOn : T.trialOff);
  if (changed('security_locked_at')) out.push(n.security_locked_at ? T.lockOn : T.lockOff);
  if (changed('rep_auto_assign')) out.push(n.rep_auto_assign ? T.autoOn : T.autoOff);
  if (changed('member_bonus_cap')) out.push(T.cap);
  if (changed('balance_waived_at') && n.balance_waived_at) out.push(T.waived);
  if (changed('invite_code') && n.invite_code) out.push(T.invite);
  return out;
}

function logList(id) {
  const A = s.adminLive;
  // Aynı saniyedeki kayıtlar (ör. başvuru ve izin) tek satırda
  const groups = [];
  for (const l of (admin?.log ?? []).filter((x) => x.entity_id === id)) {
    const text = logSentences(l);
    if (!text.length) continue;
    const when = new Date(l.at).toLocaleString(LOCALE);
    const last = groups[groups.length - 1];
    if (last?.when === when) last.text = [...text, ...last.text];
    else groups.push({ when, text });
  }
  if (!groups.length) return `<p class="muted small">${esc(A.logEmpty)}</p>`;
  return `<ul class="pp-list small">${groups
    .slice(0, 10)
    .map((g) => `<li><span class="muted">${esc(g.when)}</span><br>${g.text.map(esc).join('<br>')}</li>`)
    .join('')}</ul>`;
}

// Komisyon tetikleyicisinde hata varsa yönetici ekranlarının başında uyarı
const errorsWarn = () => (admin?.errors ? `<div class="notice">${esc(fmt(s.adminLive.errorsWarn, { n: admin.errors }))}</div>` : '');

// Temsilcinin son kanal bildirimi (bahis reklamı var → kırmızı bayrak); sadece yönetici görür
function channelFlag(id) {
  const A = s.adminLive;
  const last = (admin?.checks ?? []).find((c) => c.partner_id === id);
  if (!last) return A.flagNone;
  const m = new Date(last.month).toLocaleDateString(LOCALE, { month: 'short', year: 'numeric' });
  return last.betting_ads ? `<span class="pill cancelled" title="${esc(last.note ?? '')}">🚩 ${esc(fmt(A.flagged, { m }))}</span>` : `<span class="muted small">${esc(fmt(A.flagClean, { m }))}</span>`;
}

function adminPartnersScreen() {
  const A = s.adminLive;
  // İncelemedekiler ve reddedilenler burada görünmez (Salih, 2026-11-06); kayıtları mükerrer başvuru denetimi için durur
  const list = (admin?.partners ?? []).filter((p) => !['application', 'rejected'].includes(p.status));
  const reps = list.filter((p) => p.is_rep && p.status === 'approved');
  const rows = list.map((p) => [
    `<span class="pp-mono">${esc(p.partner_no)}</span>`,
    `<b>${esc(p.priv.full_name || '–')}</b>`,
    `${esc(A.statuses[p.status] ?? p.status)}${p.security_locked_at ? ` <span class="pill cancelled">${esc(s.apply.rep.badge)}</span>` : ''}`,
    channelFlag(p.id),
    pctRate(Number(p.rate)),
    p.is_rep ? '✓' : '',
    p.is_rep ? pctRate(Number(p.rep_rate)) : '',
    esc(p.rep_id ? admin.name[p.rep_id] ?? '–' : '–'),
    p.trial ? '✓' : '',
    money(p.balance.available),
    money(p.balance.pending),
    `<button type="button" class="secondary small" data-edit="${p.id}">${esc(A.edit)}</button>`,
  ]);
  const edit = list.find((p) => p.id === state.editPartner);
  const form = edit
    ? `<section class="pp-card" id="pedit" data-id="${edit.id}"><h3>${esc(edit.priv.full_name || edit.partner_no)}</h3>
  <div class="pp-grid2 tight">
    <label>${esc(A.partnerCols[2])}<select name="status">${['approved', 'suspended', 'terminated'].map((k) => `<option value="${k}"${edit.status === k ? ' selected' : ''}>${esc(A.statuses[k])}</option>`).join('')}</select></label>
    <label>${esc(A.rate)}${rateSelect('name="rate"', Number(edit.rate))}</label>
    <label>${esc(A.repOf)}<select name="rep_id"><option value="">${esc(A.noneRep)}</option>${reps.filter((r) => r.id !== edit.id).map((r) => `<option value="${r.id}"${edit.rep_id === r.id ? ' selected' : ''}>${esc(r.priv.full_name || r.partner_no)}</option>`).join('')}</select></label>
    <label>${esc(A.note)}<input name="admin_note" value="${esc(edit.admin_note ?? '')}"></label>
  </div>
  <label class="pp-check"><input type="checkbox" name="is_rep"${edit.is_rep ? ' checked' : ''}> ${esc(A.isRep)}</label>
  <label class="pp-check"><input type="checkbox" name="trial"${edit.trial ? ' checked' : ''}> ${esc(A.trial)}</label>
  <div class="pp-actions left"><button type="button" id="psave">${esc(A.save)}</button><button type="button" class="secondary" id="pmfa">${esc(A.mfaReset)}</button>${edit.security_locked_at ? `<button type="button" class="danger" id="punlock">${esc(s.apply.rep.unlock)}</button>` : ''}</div><div class="msg" id="pmsg"></div>
  ${!CHANNEL_CHECK_OPEN ? '' : `<h4 class="pp-sub">${esc(A.channelHistory)}</h4>${
    (admin.checks ?? []).filter((c) => c.partner_id === edit.id).length
      ? `<ul class="pp-list small">${admin.checks
          .filter((c) => c.partner_id === edit.id)
          .map((c) => `<li>${esc(new Date(c.month).toLocaleDateString(LOCALE, { month: 'long', year: 'numeric' }))}: ${c.betting_ads ? '🚩 ' + esc(s.rep.yes) : esc(s.rep.no)}${c.note ? ` · ${esc(c.note)}` : ''}</li>`)
          .join('')}</ul>`
      : `<p class="muted small">${esc(A.logEmpty)}</p>`
  }`}
  <h4 class="pp-sub">${esc(A.log)}</h4>${logList(edit.id)}</section>`
    : '';
  const dropCheck = (x) => (CHANNEL_CHECK_OPEN ? x : x.filter((_, i) => i !== 3));
  return `${form}${table(dropCheck(A.partnerCols), rows.map(dropCheck))}`;
}

function adminPayoutsScreen() {
  const A = s.adminLive;
  const list = admin?.payouts ?? [];
  if (!list.length) return `<p class="pp-empty">${esc(A.noPayouts)}</p>`;
  const rows = list.map((x) => [
    esc(x.period.slice(0, 7)),
    `<b>${esc(x.name)}</b>`,
    money(Number(x.amount_try)),
    money(Number(x.withholding_try)),
    `<b>${money(Number(x.net_try))}</b>`,
    `<span class="pp-mono">${esc(x.iban ?? `•••• ${x.iban_son4}`)}</span>`,
    esc(s.live.payoutStatus[x.status]),
    ['listed', 'approved'].includes(x.status)
      ? `${x.status === 'listed' ? `<button type="button" class="secondary small" data-pay="${x.id}:approved">${esc(A.markApproved)}</button> ` : ''}<button type="button" class="small" data-pay="${x.id}:paid">${esc(A.markPaid)}</button> <button type="button" class="secondary small" data-pay="${x.id}:cancelled">${esc(A.cancel)}</button>`
      : '',
  ]);
  return `<div class="pp-actions"><span></span><span class="pp-actions"><button type="button" class="secondary" id="taxfile">${esc(A.taxFile)}</button><button type="button" class="secondary" id="bankfile">${esc(A.bankFile)}</button></span></div><p class="muted small">${esc(A.taxFileNote)}</p>${table(A.payoutCols, rows)}`;
}

function adminSettingsScreen() {
  const A = s.adminLive;
  const st = admin?.settings ?? {};
  const val = (k) => st[k];
  const sel = (key, opts) => `<select data-set="${key}">${Object.entries(opts).map(([k, v]) => `<option value="${k}"${val(key) === k ? ' selected' : ''}>${esc(v)}</option>`).join('')}</select>`;
  const numIn = (key, mult = 1) => `<input data-set="${key}" data-mult="${mult}" type="number" step="any" value="${Number(val(key) ?? 0) * mult}">`;
  return `<p class="muted">${esc(A.settingsIntro)}</p>
<section class="pp-card"><div class="pp-grid2 tight">
  <label>${esc(A.mode)}${sel('program_mode', A.modes)}</label>
  <label>${esc(A.access)}${sel('program_access', A.accesses)}</label>
  <label>${esc(A.defaultRate)}${numIn('default_rate', 100)}</label>
  <label>${esc(A.minPayout)}${numIn('min_payout_try')}</label>
  <label>${esc(A.memberBonus)}${numIn('member_bonus_try')}</label>
  <label>${esc(A.memberCap)}${numIn('member_bonus_monthly_cap')}</label>
  <label>${esc(A.contractVersion)}<input data-set="contract_version" data-text="1" type="text" inputmode="decimal" pattern="[0-9]{1,2}\\.[0-9]{1,2}" value="${esc(val('contract_version') ?? '1.0')}"></label>
</div>
<p class="muted small">${esc(A.contractVersionNote)}</p>
<label class="pp-check"><input type="checkbox" data-set="foreign_payouts_open"${val('foreign_payouts_open') ? ' checked' : ''}> ${esc(A.foreign)}</label>
<div class="pp-actions left"><button type="button" id="ssave">${esc(A.save)}</button></div><div class="msg" id="smsg"></div></section>
<section class="pp-card"><h3>${esc(A.repTiers)}</h3>${table(s.rep.tierCols, (val('rep_tiers') ?? []).map((t, i, arr) => [`${int(t.from)}${arr[i + 1] ? ` – ${int(arr[i + 1].from - 1)}` : '+'}`, pctRate(t.rate)]))}
<p class="muted small">${esc(A.fx)}: ${esc(val('fx_usd_try') ?? '–')}</p></section>`;
}

function adminRepsLiveScreen() {
  const a = s.admin;
  const reps = (admin?.partners ?? []).filter((p) => p.is_rep && p.status === 'approved');
  const month = new Date();
  month.setDate(1);
  const rows = reps.map((r) => {
    const mine = admin.partners.filter((p) => p.rep_id === r.id);
    const fresh = mine.filter((p) => p.rep_linked_by === 'invite' && Date.parse(p.created_at) > Date.now() - 30 * DAY).length;
    const scores = admin.feedback.filter((f) => f.rep_id === r.id && Date.parse(f.month) >= month.getTime() - 31 * DAY).map((f) => f.score);
    const avg = scores.length ? scores.reduce((x, y) => x + y, 0) / scores.length : null;
    return [`<b>${esc(r.priv.full_name || r.partner_no)}</b>`, '–', int(mine.length), int(fresh), '–', '–', avg == null ? '–' : `${avg.toFixed(1)} / 5`, '–', '–', pctRate(Number(r.rep_rate)), esc(r.rep_auto_assign ? a.on : a.off)];
  });
  return `<p class="muted">${esc(a.intro)}</p>${table(a.cols, rows)}`;
}

// ---- Yönlendirme ----
const ROUTES = {
  'ana-sayfa': { title: s.menu.home, render: homeScreen, period: true },
  baglantilar: { title: s.menu.links, render: linksScreen },
  bannerlar: { title: s.menu.banners, render: bannersScreen },
  komisyon: { title: s.menu.commission, render: commissionScreen },
  odemeler: { title: s.menu.payouts, render: payoutsScreen },
  'raporlar/ozet': { title: s.menu.summary, render: summaryScreen, period: true },
  'raporlar/kampanya': { title: s.menu.byCampaign, render: campaignScreen, period: true },
  'raporlar/kullanici': { title: s.menu.users, render: usersScreen },
  profil: { title: s.menu.profile, render: profileScreen },
  iletisim: { title: s.menu.contact, render: contactScreen },
  temsilci: { title: s.rep.title, render: repScreen },
  'temsilci/isaretler': { title: s.flags.title, render: flagsScreen },
  'yonetici/temsilciler': { title: s.admin.title, render: () => (SAMPLE ? adminRepsScreen() : adminRepsLiveScreen()) },
  'yonetici/basvurular': { title: s.adminLive.applications, render: () => errorsWarn() + adminApplicationsTabs() },
  'yonetici/partnerler': { title: s.adminLive.partners, render: () => errorsWarn() + adminPartnersScreen() },
  'yonetici/odemeler': { title: s.adminLive.payouts, render: () => errorsWarn() + adminPayoutsScreen() },
  'yonetici/ayarlar': { title: s.adminLive.settings, render: () => errorsWarn() + adminSettingsScreen() },
  tanitim: { title: s.landing.title, render: landingScreen, public: true },
  giris: { title: s.login.title, render: loginScreen, public: true },
  'iki-adim': { title: s.twoFactor.title, render: twoFactorScreen, public: true },
  basvuru: { title: s.apply.title, render: applyScreen, public: true },
  ulke: { title: s.apply.wizard.countryTitle, render: countryScreen, public: true },
  yukleniyor: { title: s.live.loading, render: loadingScreen, public: true },
  kapali: { title: s.live.closedTitle, render: closedScreen, public: true },
  acil: { title: s.apply.rep.lockTitle, render: lockScreen, public: true },
  inceleniyor: { title: s.live.reviewTitle, render: reviewScreen, public: true },
  temsilcilik: { title: s.apply.rep.formTitle, render: repApplyScreen, get public() { return !isPartner(); } },
  'sozlesme-onay': { title: s.live.contractTitle, render: contractScreen, public: true },
  hata: { title: s.live.errors.generic, render: () => stateScreen(s.live.errors.generic, state.error), public: true },
};
const G_MAIN = [s.menu.main, [['ana-sayfa', s.menu.home], ['komisyon', s.menu.commission], ['odemeler', s.menu.payouts], ['profil', s.menu.profile], ['iletisim', s.menu.contact]]];
const G_PROMO = [s.menu.promo, [['baglantilar', s.menu.links], ['bannerlar', s.menu.banners]]];
const G_REPORTS = [s.menu.reports, [['raporlar/ozet', s.menu.summary], ['raporlar/kampanya', s.menu.byCampaign], ['raporlar/kullanici', s.menu.users]]];
const G_REP = [s.rep.group, [['temsilci', s.rep.menu], ['temsilci/isaretler', s.flags.menu]]];
const G_ADMIN = [
  s.adminLive.group,
  [['yonetici/basvurular', s.adminLive.applications], ['yonetici/partnerler', s.adminLive.partners], ['yonetici/temsilciler', s.admin.reps], ['yonetici/odemeler', s.adminLive.payouts], ['yonetici/ayarlar', s.adminLive.settings]],
];
// Önizleme (?ornek=1): her rolün menüsü elle seçilir. Bir kişi hem partner hem temsilci olabilir.
const MENUS = {
  partner: [G_MAIN, G_PROMO, G_REPORTS],
  rep: [G_REP, [s.menu.main, [['odemeler', s.menu.payouts], ['profil', s.menu.profile], ['iletisim', s.menu.contact]]]],
  both: [G_MAIN, G_REP, G_PROMO, G_REPORTS],
  admin: [G_ADMIN],
};
const PREVIEW_MENU = [['tanitim', s.menu.landing], ['giris', s.menu.login], ['iki-adim', s.menu.twoFactor], ['basvuru', s.menu.apply]];
// Kurumsal bölüm: hukuki metinler pencerede açılır ("site:" önekli olanlar winwaystats.com sayfalarından alınır)
const CORP = [
  ['site:hakkimizda', s.corp.about],
  ['sozlesme', s.apply.contractLink],
  ['aydinlatma', s.apply.privacyLink],
  ['gdpr', s.apply.gdprLink],
  ['site:gizlilik', s.corp.privacy],
  ['site:kvkk', s.corp.kvkk],
  ['site:kullanici-sozlesmesi', s.corp.terms],
];
const corpLinks = (contactHref) => `${CORP.map(([k, l]) => `<a href="#" data-legal="${k}">${esc(l)}</a>`).join('')}<a href="${contactHref}">${esc(s.corp.contact)}</a>`;
// ---- Tercihler (tarayıcıda; okunamazsa varsayılan) ----
const load = (k) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const store = (k, v) => {
  try {
    if (v == null) localStorage.removeItem(k);
    else localStorage.setItem(k, v);
  } catch {}
};
try {
  state.closed = JSON.parse(load('wwp-closed') || '{}');
} catch {
  state.closed = {};
}
// Tema: kayıtlı seçim yoksa cihazın teması
const currentTheme = () => load('wwp-theme') || (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
function setTheme(t) {
  store('wwp-theme', t);
  document.documentElement.dataset.theme = t;
}
document.documentElement.dataset.theme = currentTheme();
const themeButton = () => `<button type="button" class="pp-theme" data-theme-toggle aria-label="${esc(s.theme.label)}"><span>${currentTheme() === 'dark' ? '☾' : '☀'} ${esc(s.theme.label)}</span><b>${esc(currentTheme() === 'dark' ? s.theme.dark : s.theme.light)}</b></button>`;
// Dil seçici: seçim cihazda saklanır, sayfa o dilin adresiyle yeniden açılır (oturum ve açık sayfa korunur)
const langSelect = () =>
  `<label class="pp-lang"><span class="sr">${esc(s.langLabel)}</span><select id="pp-lang" aria-label="${esc(s.langLabel)}">${Object.entries(W.langs ?? { tr: 'Türkçe' })
    .map(([k, v]) => `<option value="${k}"${k === LANG ? ' selected' : ''}>${esc(v)}</option>`)
    .join('')}</select></label>`;
const isPartner = () => ['approved', 'suspended'].includes(me?.partner?.status);
// Gerçek mod: menü hesabın durumundan çıkar
function liveMenu() {
  const groups = [];
  if (isPartner()) groups.push(G_MAIN);
  if (isPartner() && !me.partner.is_rep) groups.push([s.apply.rep.menu, [['temsilcilik', s.apply.rep.menu]]]);
  if (isPartner() && me.partner.is_rep) groups.push(G_REP);
  if (isPartner()) groups.push(G_PROMO, G_REPORTS);
  if (me?.admin) {
    groups.push(G_ADMIN);
    if (!isPartner()) groups.push([s.apply.title, [[me?.partner?.status === 'application' ? 'inceleniyor' : 'basvuru', s.apply.title]]]);
  }
  return groups;
}

const readRole = () => {
  try {
    return localStorage.getItem('wwp-role') || 'partner';
  } catch {
    return 'partner';
  }
};
// Önizlemede adresle görünüm seçme: ?ornek=1&gorunum=partner | temsilci | ikisi | yonetici
const ROLE_PARAM = { partner: 'partner', temsilci: 'rep', ikisi: 'both', yonetici: 'admin' };
const fromUrl = ROLE_PARAM[new URLSearchParams(location.search).get('gorunum')];
state.role = fromUrl || (MENUS[readRole()] ? readRole() : 'partner');
const menus = () => (SAMPLE ? MENUS[state.role] : liveMenu());
const allowedKeys = () => menus().flatMap(([, items]) => items.map(([k]) => k));
const homeKey = () => allowedKeys()[0] ?? 'yukleniyor';
const STAGE_ROUTE = { loading: 'yukleniyor', login: 'giris', mfa: 'iki-adim', closed: 'kapali', review: 'inceleniyor', apply: 'basvuru', contract: 'sozlesme-onay', error: 'hata' };

function currentRoute() {
  const key = location.hash.replace(/^#\/?/, '').split('?')[0] || homeKey();
  if (key === 'acil') return 'acil';
  // E-postadaki temsilcilik düğmesi: giriş yapılmadıysa önce giriş, adres korunur
  if (!SAMPLE && stage === 'login') return key === 'giris' || key === 'ulke' ? key : key === 'temsilcilik' ? 'giris' : 'tanitim';
  if (!SAMPLE && stage !== 'panel') return key === 'tanitim' || (key === 'ulke' && stage === 'apply') || (key === 'temsilcilik' && stage === 'review') ? key : STAGE_ROUTE[stage];
  if (SAMPLE && ROUTES[key]?.public) return key;
  if (!SAMPLE && ['tanitim', 'basvuru', 'inceleniyor'].includes(key) && (key === 'tanitim' || allowedKeys().includes(key))) return key;
  return ROUTES[key] && allowedKeys().includes(key) ? key : homeKey();
}

function render() {
  const key = currentRoute();
  const route = ROUTES[key];
  const roleSel = `<label class="pp-role">${esc(s.roles.label)}: <select id="role">${['partner', 'rep', 'both', 'admin'].map((r) => `<option value="${r}"${r === state.role ? ' selected' : ''}>${esc(s.roles[r])}</option>`).join('')}</select></label>`;
  const banner = SAMPLE ? `<div class="pp-banner">${esc(s.previewBanner)} ${roleSel}</div>` : '';
  const signedIn = !SAMPLE && !['loading', 'login'].includes(stage);
  document.title = `${route.title} · ${s.title}`;
  if (route.public) {
    app.innerHTML = `${banner}<header class="pp-pubbar"><a class="pp-brand" href="#/tanitim"><img src="/icon.png" alt="" width="28" height="28">Winway <span>Partners</span></a>
<nav>${langSelect()}${key === 'tanitim' ? `<span class="pp-anchors">${['neden', 'urun', 'nasil', 'sss'].map((id, i) => `<a href="#" data-scroll="${id}">${esc(Object.values(s.promo.nav)[i])}</a>`).join('')}</span>` : ''}${themeButton()}${SAMPLE ? `<a href="#/${homeKey()}">${esc(s.menu.home)}</a><a href="#/giris">${esc(s.menu.login)}</a>` : signedIn ? `${stage === 'panel' ? `<a href="#/${homeKey()}">${esc(s.menu.home)}</a>` : ''}<a href="#/cikis">${esc(s.menu.signOut)}</a>` : `<a href="#/giris">${esc(s.menu.login)}</a>`}</nav></header>
<main class="pp-pub">${route.render()}</main>
<footer class="pp-pubfoot">${corpLinks('mailto:info@winway.com.tr')}</footer>`;
  } else {
    // Menü başlıkları açılır kapanır; içinde bulunulan sayfanın başlığı her zaman açık
    const group = (title, items) => {
      const open = state.closed[title] !== true || items.some(([k]) => k === key);
      return `<details class="pp-group" data-group="${esc(title)}"${open ? ' open' : ''}><summary>${esc(title)}</summary><div class="pp-group-list">${items.map(([k, label]) => `<a href="#/${k}"${k === key ? ' aria-current="page"' : ''}>${esc(label)}</a>`).join('')}</div></details>`;
    };
    const nav = menus().map(([title, items]) => group(title, items)).join('');
    const preview = SAMPLE ? group(s.menu.previewPages, PREVIEW_MENU) : '';
    const periodSel = route.period
      ? `<select id="period" aria-label="${esc(s.periodLabel)}">${Object.entries(s.periods).map(([k, v]) => `<option value="${k}"${k === state.period ? ' selected' : ''}>${esc(v)}</option>`).join('')}</select>`
      : '';
    const curSel = `<select id="currency" aria-label="${esc(s.currencyLabel)}" title="${esc(s.currencyNote)}">${Object.keys(FX).map((c) => `<option${c === state.currency ? ' selected' : ''}>${c === 'TRY' ? 'TL' : c}</option>`).join('')}</select>`;
    app.innerHTML = `${banner}<div class="pp-shell">
<aside class="pp-side" id="side"><a class="pp-brand" href="#/${homeKey()}"><img src="/icon.png" alt="" width="28" height="28">Winway <span>Partners</span></a>${nav}${preview}
<details class="pp-group pp-corp" id="corp"${state.corpOpen ? ' open' : ''}><summary>${esc(s.corp.title)}</summary><div class="pp-corp-list">${corpLinks(allowedKeys().includes('iletisim') ? '#/iletisim' : 'mailto:info@winway.com.tr')}</div></details>
${langSelect()}${themeButton()}
<a class="pp-signout" href="#/${SAMPLE ? 'giris' : 'cikis'}"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/></svg>${esc(s.signOutSafe)}</a></aside>
<div class="pp-scrim" id="scrim"></div>
<div class="pp-main">
  <header class="pp-top"><button type="button" class="secondary small pp-burger" id="burger" aria-label="${esc(s.menu.openMenu)}">☰</button><h1>${esc(route.title)}</h1><div class="pp-sel">${periodSel}${curSel}<a class="pp-logout" href="#/${SAMPLE ? 'giris' : 'cikis'}" title="${esc(s.signOutSafe)}"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/></svg><span>${esc(s.signOutSafe)}</span></a></div></header>
  <div class="pp-content">${route.render()}</div>
</div></div>`;
  }
  bind(key);
}

function rerender() {
  const y = window.scrollY;
  render();
  window.scrollTo(0, y);
}

// ---- Gerçek mod: oturum akışı ----
// Sıra: oturum → erişim (program kapalıysa iki adımlı doğrulama da istenmez) → iki adımlı doğrulama → başvuru / panel
async function boot() {
  if (SAMPLE) return render();
  stage = 'loading';
  render();
  try {
    const session = await live.session();
    if (!session) {
      stage = 'login';
      return render();
    }
    // Erişim ve doğrulama durumu aynı anda okunur; ikisi de ağ isteği
    const [meNow, m] = await Promise.all([live.me(), live.mfa()]);
    me = meNow;
    if (!me.access) {
      stage = 'closed';
      return render();
    }
    if (m.current !== 'aal2') {
      if (m.verified) mfa = { factorId: m.verified.id, qr: null, secret: null };
      else {
        const e = await live.enroll();
        mfa = { factorId: e.id, qr: e.totp.qr_code, secret: e.totp.secret };
      }
      stage = 'mfa';
      return render();
    }
    if (Number(me.settings?.fx_usd_try)) FX.USD = Number(me.settings.fx_usd_try);
    if (Number(me.settings?.fx_eur_try)) FX.EUR = Number(me.settings.fx_eur_try);
    [data, admin] = await Promise.all([isPartner() ? live.loadPartner(me) : EMPTY(), me.admin ? live.loadAdmin() : null]);
    stage = needsContract() ? 'contract' : isPartner() || me.admin ? 'panel' : me.partner?.status === 'application' ? 'review' : 'apply';
  } catch (e) {
    state.error = errText(e);
    stage = 'error';
  }
  render();
}

async function reload() {
  me = await live.me();
  if (isPartner()) data = await live.loadPartner(me);
  if (me.admin) admin = await live.loadAdmin();
  rerender();
}

// Turnstile betiği sayfayla birlikte geç yüklenebilir: hazır değilse kısa aralıkla tekrar denenir; kutu bir kez çizilir
function renderCaptcha() {
  const box = app.querySelector('#captcha');
  if (!box || box.dataset.drawn) return;
  if (!window.turnstile) return void setTimeout(renderCaptcha, 300);
  box.dataset.drawn = '1';
  captchaToken = null;
  window.turnstile.render(box, {
    sitekey: W.siteKey,
    theme: currentTheme(),
    callback: (t) => (captchaToken = t),
    'expired-callback': () => (captchaToken = null),
    'error-callback': () => (captchaToken = null),
  });
}

// Bir düğmenin işini yapar; çalışırken düğmeyi kilitler, hatayı mesaj alanına yazar
async function act(btn, msgEl, fn) {
  // Önizlemede (örnek veri) sunucuya hiçbir şey gönderilmez
  if (SAMPLE) {
    if (msgEl) {
      msgEl.textContent = s.profile.previewOnly;
      msgEl.className = 'msg';
    }
    return;
  }
  if (btn) btn.disabled = true;
  if (msgEl) {
    msgEl.textContent = '';
    msgEl.className = 'msg';
  }
  try {
    await fn();
  } catch (e) {
    if (msgEl) {
      msgEl.textContent = errText(e);
      msgEl.className = 'msg error';
    }
  } finally {
    if (btn) btn.disabled = false;
  }
}

function bind(key) {
  const $ = (sel) => app.querySelector(sel);
  const $$ = (sel) => app.querySelectorAll(sel);
  $('#burger')?.addEventListener('click', () => {
    $('#side').classList.toggle('open');
    $('#scrim').classList.toggle('open');
  });
  $('#scrim')?.addEventListener('click', () => {
    $('#side').classList.remove('open');
    $('#scrim').classList.remove('open');
  });
  $('#period')?.addEventListener('change', (e) => {
    state.period = e.target.value;
    rerender();
  });
  $('#currency')?.addEventListener('change', (e) => {
    state.currency = e.target.value === 'TL' ? 'TRY' : e.target.value;
    rerender();
  });
  $$('[data-chart]').forEach((b) =>
    b.addEventListener('click', () => {
      state.chart = b.dataset.chart;
      rerender();
    }),
  );
  app.querySelector('#chart')?.addEventListener('click', (e) => {
    const b = e.target.closest('[data-series]');
    if (!b) return;
    const k = `${state.chart}:${b.dataset.series}`;
    if (state.hidden.has(k)) state.hidden.delete(k);
    else state.hidden.add(k);
    app.querySelector('#chart').innerHTML = chartSvg();
  });
  $$('[data-users]').forEach((b) =>
    b.addEventListener('click', () => {
      state.usersTab = b.dataset.users;
      rerender();
    }),
  );
  $$('[data-ptab]').forEach((b) =>
    b.addEventListener('click', () => {
      state.payoutTab = b.dataset.ptab;
      rerender();
    }),
  );
  $$('[data-star]').forEach((b) =>
    b.addEventListener('click', () =>
      act(null, $('#star-msg'), async () => {
        if (!SAMPLE) await live.rateRep(Number(b.dataset.star));
        $$('[data-star]').forEach((x) => x.classList.toggle('on', Number(x.dataset.star) <= Number(b.dataset.star)));
        $('#star-msg').textContent = s.myRep.thanks;
      }),
    ),
  );
  $('#rep-change')?.addEventListener('click', (e) =>
    act(e.currentTarget, $('#star-msg'), async () => {
      if (!SAMPLE) await live.requestRepChange('');
      $('#star-msg').textContent = SAMPLE ? `${s.myRep.changeNote} ${s.profile.previewOnly}` : s.myRep.changeNote;
    }),
  );
  $('#role')?.addEventListener('change', (e) => {
    state.role = e.target.value;
    try {
      localStorage.setItem('wwp-role', state.role);
    } catch {}
    location.hash = `#/${homeKey()}`;
    render();
  });
  $$('[data-decide]').forEach((b) =>
    b.addEventListener('click', () => {
      const card = b.closest('[data-flag]');
      const msg = card.querySelector('[data-fmsg]');
      const note = card.querySelector('[data-note]').value.trim();
      if (b.dataset.decide === 'suspicious' && !note) {
        msg.textContent = s.flags.noteRequired;
        msg.className = 'msg error';
        return;
      }
      if (SAMPLE) {
        msg.textContent = s.flags.done;
        msg.className = 'msg';
        return;
      }
      act(b, msg, async () => {
        await live.decideFlag(Number(card.dataset.flag), b.dataset.decide, note);
        await reload();
      });
    }),
  );
  $$('[data-copy]').forEach((b) => b.addEventListener('click', () => copy(b.dataset.copy, b)));
  $$('[data-create]').forEach((form) =>
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const msg = app.querySelector(`[data-msg="${form.dataset.create}"]`);
      if (SAMPLE) {
        const res = api.createCampaign(form.elements.name.value);
        if (res.error) {
          msg.textContent = res.error;
          msg.className = 'msg error';
          return;
        }
        state.lastCreated = res.campaign;
        return rerender();
      }
      act(form.querySelector('button'), msg, async () => {
        const c = await live.createCampaign(form.elements.name.value);
        state.lastCreated = { name: c.name, code: c.code };
        await reload();
      });
    }),
  );
  $$('[data-banner]').forEach((b) =>
    b.addEventListener('click', () => {
      const [name, size] = s.banners.items[Number(b.dataset.banner)];
      const [w, h] = size.split(' × ').map(Number);
      // Telegram / Instagram / WhatsApp SVG kabul etmez: görsel tuvale çizilip PNG olarak indirilir
      svgToPng(bannerSvg(w, h), w, h, `winwaystats-${slug(name)}-${w}x${h}.png`);
    }),
  );
  $$('[data-qr]').forEach((b) =>
    b.addEventListener('click', async () => {
      const { svg, size } = await qrSvg(b.dataset.qr, 12);
      svgToPng(svg, size, size, `winwaystats-qr-${slug(b.dataset.qrname)}.png`);
    }),
  );
  const uf = $('#ufilters');
  if (uf) {
    const apply = () => {
      const pos = uf.elements.q.selectionStart;
      for (const k of ['q', 'campaign', 'status', 'country']) state.filters[k] = uf.elements[k].value;
      state.usersLimit = 50;
      rerender();
      const q = app.querySelector('#ufilters').elements.q;
      if (document.activeElement !== q && pos != null && key === 'raporlar/kullanici' && state.filters.q) {
        q.focus();
        q.setSelectionRange(pos, pos);
      }
    };
    uf.addEventListener('change', apply);
    uf.elements.q.addEventListener('input', apply);
    uf.addEventListener('submit', (e) => e.preventDefault());
  }
  $('#more-users')?.addEventListener('click', () => {
    state.usersLimit += 50;
    rerender();
  });
  $('#dl-users')?.addEventListener('click', () =>
    downloadCsv(
      'winway-partners-kullanicilar.csv',
      s.reports.userCols,
      api.users(state.filters).map((u) => [u.account, u.campaign, date(u.registeredAt), countryName(u.country), planLabel(u.product), s.reports.status[u.status], u.subStart ? date(u.subStart) : '', u.cancelAt ? date(u.cancelAt) : '', money(u.company), money(u.amount), s.member.states[u.member]]),
    ),
  );
  $('#dl-campaigns')?.addEventListener('click', () =>
    downloadCsv(
      'winway-partners-kampanyalar.csv',
      s.reports.campaignCols,
      api.campaigns(periodRange(state.period)).map((c) => [c.name, c.clicks, c.signups, pct(c.signupRate), c.newSubs, c.activeSubs, money(c.company), money(c.commission)]),
    ),
  );
  $('#dl-payouts')?.addEventListener('click', () =>
    downloadCsv('winway-partners-odemeler.csv', s.payouts.cols, api.payouts().map((x) => [date(x.at), `${date(x.periodFrom)} – ${date(x.periodTo)}`, money(x.amount), s.payouts.method, '', x.status && x.status !== 'paid' ? s.live.payoutStatus[x.status] : s.payouts.paid])),
  );
  $('#mkt-toggle')?.addEventListener('change', (e) => {
    const on = e.target.checked;
    const m = $('#mkt-msg');
    act(null, m, async () => {
      await live.setMarketing(on);
      data.profile.marketing = on;
      m.textContent = s.apply.marketingSaved;
    });
  });
  $('#iban-btn')?.addEventListener('click', () => {
    if (SAMPLE) {
      $('#iban-msg').textContent = `${s.profile.ibanNote} ${s.profile.previewOnly}`;
      return;
    }
    $('#iban-msg').outerHTML = `<form id="iban-form"><label>${esc(s.live.ibanNew)}<input name="iban" required></label><label>${esc(s.live.holderNew)}<input name="holder" required></label><button type="submit">${esc(s.live.ibanSave)}</button><p class="muted small">${esc(s.profile.ibanNote)}</p><div class="msg" id="iban-fmsg"></div></form>`;
    $('#iban-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const f = e.currentTarget.elements;
      act(e.currentTarget.querySelector('button'), $('#iban-fmsg'), async () => {
        await live.changeIban(f.iban.value, f.holder.value);
        await reload();
      });
    });
  });

  // Giriş, iki adımlı doğrulama, başvuru
  $('#login-form')?.addEventListener('submit', (e) => {
    e.preventDefault();
    if (SAMPLE) {
      location.hash = '#/iki-adim';
      return;
    }
    const f = e.currentTarget.elements;
    const msg = $('#login-msg');
    if (window.turnstile && !captchaToken) {
      msg.textContent = s.live.captchaWait;
      msg.className = 'msg error';
      return;
    }
    act(e.currentTarget.querySelector('button'), msg, async () => {
      try {
        await live.signIn(f.email.value.trim(), f.password.value, captchaToken);
      } catch (err) {
        if (window.turnstile) window.turnstile.reset();
        captchaToken = null;
        throw err;
      }
      await boot();
    });
  });
  if ($('#captcha')) renderCaptcha();

  // Şifre sıfırlama
  $$('[data-forgot]').forEach((a) =>
    a.addEventListener('click', (e) => {
      e.preventDefault();
      forgot = a.dataset.forgot === 'login' ? null : { step: 'email', email: forgot?.email ?? '' };
      captchaToken = null;
      rerender();
    }),
  );
  const forgotMsg = (text) => {
    const msg = $('#forgot-msg');
    msg.textContent = text;
    msg.className = 'msg error';
  };
  $('#forgot-email')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const email = e.currentTarget.elements.email.value.trim();
    if (window.turnstile && !captchaToken) return forgotMsg(s.live.captchaWait);
    act(e.currentTarget.querySelector('button'), $('#forgot-msg'), async () => {
      try {
        await live.requestReset(email, captchaToken);
      } catch (err) {
        if (window.turnstile) window.turnstile.reset();
        captchaToken = null;
        throw err;
      }
      forgot = { step: 'code', email };
      captchaToken = null;
      rerender();
    });
  });
  $('#forgot-code')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const code = e.currentTarget.elements.code.value.trim();
    if (!/^\d{6}$/.test(code)) return forgotMsg(s.login.reset.codeInvalid);
    act(e.currentTarget.querySelector('button'), $('#forgot-msg'), async () => {
      await live.verifyReset(forgot.email, code);
      const m = await live.mfa();
      forgot = m.verified && m.current !== 'aal2' ? { ...forgot, step: 'totp', factorId: m.verified.id } : { ...forgot, step: 'new' };
      rerender();
    });
  });
  $('#forgot-totp')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const code = e.currentTarget.elements.code.value.trim();
    if (!/^\d{6}$/.test(code)) return forgotMsg(s.twoFactor.invalid);
    act(e.currentTarget.querySelector('button'), $('#forgot-msg'), async () => {
      await live.verify(forgot.factorId, code);
      forgot = { ...forgot, step: 'new' };
      rerender();
    });
  });
  $('#forgot-new')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const f = e.currentTarget.elements;
    const pw = f.password.value;
    // Uygulamadaki şifre kuralıyla aynı (src/features/auth/validation.ts)
    if (pw.length < 8 || !/[a-z]/.test(pw) || !/[A-Z]/.test(pw) || !/\d/.test(pw) || !/[!@#$%^&*()_+\-=[\]{};'\\:"|<>?,./`~]/.test(pw)) return forgotMsg(s.login.reset.weak);
    if (pw !== f.password2.value) return forgotMsg(s.login.reset.mismatch);
    act(e.currentTarget.querySelector('button'), $('#forgot-msg'), async () => {
      await live.updatePassword(pw);
      forgot = null;
      await boot();
    });
  });
  $('#tf-form')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const v = $('#tf-code').value.trim();
    if (!/^\d{6}$/.test(v)) {
      $('#tf-msg').textContent = s.twoFactor.invalid;
      $('#tf-msg').className = 'msg error';
      return;
    }
    if (SAMPLE) {
      location.hash = '#/ana-sayfa';
      return;
    }
    act(e.currentTarget.querySelector('button'), $('#tf-msg'), async () => {
      await live.verify(mfa.factorId, v);
      mfa = { factorId: null, qr: null, secret: null };
      await boot();
    });
  });
  // ---- Başvuru: ülke seçimi ----
  if ($('#pk-start-country')) {
    loadCountries().then((list) => {
      const box = $('#pk-start-country');
      if (!box) return;
      picker(box, { name: 'start_country', items: list.map((c) => ({ v: c.c, l: `${c.f} ${LANG === 'tr' ? c.n : countryName(c.c) || c.n}` })), value: myCountry() || lastCountry, placeholder: s.apply.wizard.countryPh, onChange: (c) => { const sel = $('#country-lang'); if (sel && !sel.dataset.touched && W.langs?.[COUNTRY_LANG[c] ?? 'en']) sel.value = COUNTRY_LANG[c] ?? 'en'; }, search: s.apply.countrySearch, empty: s.apply.notFound });
    });
    // Ülke formun alanlarını belirler; dil kişinin seçimidir (Salih, 2026-11-06). Ülke seçilince dil önerilir, kişi değiştirirse o kalır.
    $('#country-lang').addEventListener('change', (e) => (e.target.dataset.touched = '1'));
    $('#country-next').addEventListener('click', () => {
      const c = app.querySelector('input[name="start_country"]')?.value;
      if (!c) {
        $('#country-msg').textContent = s.apply.wizard.countryRequired;
        $('#country-msg').className = 'msg error';
        return;
      }
      const same = c === (myCountry() || lastCountry);
      store('wwp-ulke', c);
      // Ülke değiştiyse ülkeye bağlı alanlar sıfırlanır; ad gibi bilgiler korunur
      if (!same) {
        applyStep = 1;
        for (const k of ['id_no', 'phone', 'account', 'bank_country', 'bank_name', 'swift_bic', 'bank_code', 'tax_office', 'tax_no', 'company_reg_no']) delete applyDraft[k];
      }
      const target = !SAMPLE && stage === 'login' ? '#/giris' : '#/basvuru';
      const lang = $('#country-lang').value;
      if (lang !== LANG && W.langs?.[lang]) {
        store('wwp-dil', lang);
        location.href = langPath(lang) + target;
      } else if (location.hash === target) rerender();
      else location.hash = target;
    });
  }
  // ---- Başvuru: adımlar ----
  if ($('#apply-form')) {
    const formEl = $('#apply-form');
    const f = formEl.elements;
    const country = myCountry() || 'TR';
    const tr = country === 'TR';
    const a = s.apply;
    // Taslak yeniden çizimde korunur
    for (const [k, v] of Object.entries(applyDraft)) {
      const el = f[k];
      if (!el || el.tagName === 'SELECT' && el.name.startsWith('birth_')) continue;
      if (el.type === 'checkbox') el.checked = v;
      else if (el.value !== undefined) el.value = v;
    }
    const remember = (e) => {
      const el = e.target;
      if (el?.name) applyDraft[el.name] = el.type === 'checkbox' ? el.checked : el.value;
    };
    formEl.addEventListener('input', remember);
    formEl.addEventListener('input', () => formEl.querySelectorAll('[data-step-msg]').forEach((m) => (m.textContent = '')));
    formEl.addEventListener('change', remember);
    // Doğum tarihi
    const opts = (ph, list) => `<option value="">${esc(ph)}</option>${list.map(([v, l]) => `<option value="${v}">${esc(l)}</option>`).join('')}`;
    const lastYear = new Date().getFullYear() - 18;
    const monthName = new Intl.DateTimeFormat(LOCALE, { month: 'long' });
    f.birth_year.innerHTML = opts(a.birthYear, Array.from({ length: 83 }, (_, i) => [lastYear - i, lastYear - i]));
    f.birth_month.innerHTML = opts(a.birthMonth, Array.from({ length: 12 }, (_, i) => [i + 1, monthName.format(new Date(2000, i, 1))]));
    const paintDays = () => {
      const days = new Date(Number(f.birth_year.value) || 2000, Number(f.birth_month.value) || 1, 0).getDate();
      const keep = Math.min(Number(f.birth_day.value) || 0, days);
      f.birth_day.innerHTML = opts(a.birthDay, Array.from({ length: days }, (_, i) => [i + 1, i + 1]));
      f.birth_day.value = keep ? String(keep) : '';
    };
    f.birth_year.value = applyDraft.birth_year ?? '';
    f.birth_month.value = applyDraft.birth_month ?? '';
    f.birth_day.innerHTML = opts(a.birthDay, Array.from({ length: 31 }, (_, i) => [i + 1, i + 1]));
    f.birth_day.value = applyDraft.birth_day ?? '';
    paintDays();
    f.birth_month.addEventListener('change', paintDays);
    f.birth_year.addEventListener('change', paintDays);
    // Şirketse vergi numarası
    const isCompany = () => f.entity_type.value === 'company';
    const paintEntity = () => {
      $('#company-fields').hidden = !isCompany();
      $('#person-title').textContent = isCompany() ? a.wizard.repTitle : a.person;
      $('#name-label').textContent = isCompany() ? a.wizard.repName : a.fullName;
    };
    paintEntity();
    f.entity_type.addEventListener('change', paintEntity);
    // Ödeme alanları: banka ülkesine göre
    const paintBank = (cc) => {
      const label = $('#account-label');
      const hint = $('#account-hint');
      const len = IBAN_LEN[cc];
      const code = LOCAL_CODE[cc];
      label.textContent = len ? a.iban : a.wizard.accountNo;
      hint.textContent = len ? fmt(a.wizard.ibanHint, { cc, n: len }) : '';
      f.account.placeholder = len ? `${cc}.. .... .... ....` : '';
      if ($('#code-field')) {
        $('#code-field').hidden = !code;
        if (code) {
          $('#code-label').textContent = code.label;
          f.bank_code.maxLength = code.max;
        }
      }
    };
    let bankCountry = applyDraft.bank_country || (tr ? 'TR' : country.length === 2 ? country : '');
    paintBank(tr ? 'TR' : bankCountry);
    let dial = '';
    loadCountries().then((list) => {
      const me_ = list.find((c) => c.c === country);
      if (!$('#apply-form')) return;
      dial = me_?.d ?? '';
      $('#apply-dial').textContent = `${me_?.f ?? ''} ${dial}`;
      $('#apply-country').textContent = `${me_?.f ?? ''} ${LANG === 'tr' ? me_?.n ?? country : countryName(country) || country}`;
      if ($('#pk-bank-country')) {
        picker($('#pk-bank-country'), {
          name: 'bank_country',
          items: list.filter((c) => c.c.length === 2).map((c) => ({ v: c.c, l: `${c.f} ${LANG === 'tr' ? c.n : countryName(c.c) || c.n}` })),
          value: bankCountry,
          placeholder: a.bankCountry,
          search: a.countrySearch,
          empty: a.notFound,
          onChange: (v) => {
            bankCountry = v;
            applyDraft.bank_country = v;
            paintBank(v);
          },
        });
      }
    });
    // Yazarken biçimlendirme
    f.account.addEventListener('input', () => {
      if (IBAN_LEN[tr ? 'TR' : bankCountry]) f.account.value = compact(f.account.value).replace(/(.{4})(?=.)/g, '$1 ');
    });
    if (f.swift_bic) f.swift_bic.addEventListener('input', () => (f.swift_bic.value = f.swift_bic.value.toUpperCase()));
    // Adım gösterimi
    const stepMsg = (text) => {
      const m = formEl.querySelector(`fieldset[data-step="${applyStep}"] [data-step-msg]`);
      m.textContent = text;
      m.className = text ? 'msg error' : 'msg';
    };
    const phoneValue = () => `${dial}${f.phone.value.replace(/[^\d]/g, '').replace(/^0/, '')}`;
    const birthValue = () => (f.birth_year.value && f.birth_month.value && f.birth_day.value ? `${f.birth_year.value}-${String(f.birth_month.value).padStart(2, '0')}-${String(f.birth_day.value).padStart(2, '0')}` : '');
    const paintSummary = () => {
      const acc = compact(f.account.value);
      $('#apply-summary').innerHTML = [
        ...(isCompany() ? [[a.wizard.companyName, f.company_name.value]] : []),
        [isCompany() ? a.wizard.repName : a.fullName, f.full_name.value],
        [a.country, $('#apply-country').textContent],
        [a.phone, phoneValue()],
        [a.holder, f.holder.value],
        [tr || IBAN_LEN[bankCountry] ? a.iban : a.wizard.accountNo, `•••• ${acc.slice(-4)}`],
      ].map(([k, v]) => `<div class="pp-row"><span class="muted">${esc(k)}</span> <b>${esc(v)}</b></div>`).join('');
    };
    const showStep = (n) => {
      applyStep = n;
      formEl.querySelectorAll('fieldset[data-step]').forEach((x) => (x.hidden = Number(x.dataset.step) !== n));
      const bar = app.querySelector('.pp-progress');
      if (bar) bar.outerHTML = stepper(n + 2);
      if (n === 3 && !f.holder.value.trim()) f.holder.value = isCompany() ? f.company_name.value.trim() : f.full_name.value.trim();
      if (n === 4) paintSummary();
    };
    const E = s.live.errors;
    const check = (n) => {
      if (n === 1) {
        if (isCompany()) {
          if (f.company_name.value.trim().length < 2) return E.sirket_adi;
          if (tr && f.tax_office.value.trim().length < 2) return E.vergi_dairesi;
          const tax = f.tax_no.value.trim();
          if (tr ? !validVkn(tax) && !validTckn(tax) : tax.length < 5) return E.vergi_no;
          if (f.company_address.value.trim().length < 10) return E.sirket_adresi;
        }
        if (f.full_name.value.trim().length < 3) return E.ad_soyad;
        const id = f.id_no.value.trim();
        if (tr ? !validTckn(id) : id.length < 5) return tr ? E.tc_kimlik : E.kimlik_no;
        if (!birthValue()) return a.birthRequired;
        if (f.phone.value.replace(/[^\d]/g, '').length < 7) return E.telefon;
        if (f.address.value.trim().length < 10) return E.adres;
      }
      if (n === 2) {
        const links = channelLinks(f.channel_links.value);
        if (!links) return E.kanal_baglanti;
        f.channel_links.value = links;
        if (!/^\d{1,9}$/.test(f.followers.value.trim())) return E.kanal_takipci;
      }
      if (n === 4) {
        // Zorunlu onaylar: eksikler tek tek yazılır ve kutular vurgulanır
        const need = [['accept_age', a.wizard.consentAge], ['accept_contract', a.contractLink], ['accept_privacy', a.privacyLink]];
        need.forEach(([k]) => f[k].closest('label').classList.toggle('pp-check-missing', !f[k].checked));
        const missing = need.filter(([k]) => !f[k].checked);
        if (missing.length) {
          f[missing[0][0]].closest('label').scrollIntoView({ block: 'center', behavior: 'smooth' });
          return `${a.wizard.consentIntro}\n${missing.map(([, label]) => `• ${label}`).join('\n')}`;
        }
      }
      if (n === 3) {
        if (f.holder.value.trim().length < 3) return E.hesap_sahibi;
        const acc = compact(f.account.value);
        if (tr) return /^TR\d{24}$/.test(acc) && validIban(acc) ? null : E.iban;
        if (!/^[A-Z]{2}$/.test(bankCountry)) return E.banka_ulkesi;
        if (f.bank_name.value.trim().length < 2) return E.banka_adi;
        if (!/^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(compact(f.swift_bic.value))) return E.swift_kodu;
        const code = LOCAL_CODE[bankCountry];
        if (code && !code.re.test(compact(f.bank_code.value))) return E.banka_kodu;
        const len = IBAN_LEN[bankCountry];
        if (len ? acc.length !== len || !validIban(acc) : !/^[A-Z0-9]{5,34}$/.test(acc)) return E.hesap_no;
      }
      return null;
    };
    showStep(applyStep);
    const paintRep = () => ($('#rep-info').hidden = !f.rep_info.checked);
    paintRep();
    f.rep_info.addEventListener('change', paintRep);
    const toCountry = () => {
      lastCountry = country;
      store('wwp-ulke', null);
      rerender();
      window.scrollTo(0, 0);
    };
    formEl.querySelector('[data-back-country]')?.addEventListener('click', toCountry);
    formEl.querySelectorAll('[data-back]').forEach((b) => b.addEventListener('click', () => (stepMsg(''), showStep(applyStep - 1), window.scrollTo(0, 0))));
    $('#country-change')?.addEventListener('click', (e) => {
      e.preventDefault();
      toCountry();
    });
    for (const k of ['accept_age', 'accept_contract', 'accept_privacy']) f[k].addEventListener('change', () => f[k].closest('label').classList.toggle('pp-check-missing', !f[k].checked));
    const ERROR_STEP = { kanal_baglanti: 2, kanal_takipci: 2, sirket_adi: 1, vergi_dairesi: 1, sirket_adresi: 1, ad_soyad: 1, kimlik_no: 1, tc_kimlik: 1, yas_18: 1, telefon: 1, adres: 1, vergi_no: 1, iban: 3, hesap_no: 3, hesap_sahibi: 3, banka_adi: 3, banka_ulkesi: 3, swift_kodu: 3, banka_kodu: 3 };
    formEl.addEventListener('submit', (e) => {
      e.preventDefault();
      if (SAMPLE) {
        if (applyStep < 4) showStep(applyStep + 1);
        else stepMsg(a.preview);
        return;
      }
      const problem = check(applyStep);
      if (problem) return stepMsg(problem);
      stepMsg('');
      if (applyStep < 4) {
        showStep(applyStep + 1);
        window.scrollTo(0, 0);
        return;
      }
      const fields = Object.fromEntries(['full_name', 'id_no', 'address', 'entity_type', 'channel_links', 'followers', 'holder', 'invite_code'].map((k) => [k, f[k].value]));
      if (isCompany()) Object.assign(fields, { company_name: f.company_name.value, tax_office: f.tax_office?.value ?? '', tax_no: f.tax_no.value, company_reg_no: f.company_reg_no.value, company_address: f.company_address.value });
      Object.assign(fields, { country, birth_date: birthValue(), phone: phoneValue(), iban: compact(f.account.value) });
      if (!tr) Object.assign(fields, { bank_name: f.bank_name.value, bank_country: bankCountry, swift_bic: compact(f.swift_bic.value), bank_code: compact(f.bank_code.value) });
      for (const k of ['accept_age', 'accept_contract', 'accept_privacy', 'accept_marketing', 'rep_info']) fields[k] = f[k].checked;
      const msg = $('#apply-msg');
      act(e.target.querySelector('fieldset[data-step="4"] button[type=submit]'), msg, async () => {
        try {
          await live.apply(fields);
        } catch (err) {
          const key = Object.keys(ERROR_STEP).find((k) => String(err?.message ?? '').includes(k));
          if (key) {
            showStep(ERROR_STEP[key]);
            stepMsg(errText(err));
            window.scrollTo(0, 0);
            return;
          }
          throw err;
        }
        store('wwp-ulke', null);
        applyDraft = {};
        applyStep = 1;
        await boot();
      });
    });
  }

  // Sözleşme / aydınlatma metni: açılır pencere (onay kutusunu değiştirmeden)
  $$('[data-legal]').forEach((a) =>
    a.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const title = a.textContent;
      const box = document.createElement('div');
      box.className = 'pp-modal';
      box.innerHTML = `<div class="pp-modal-card" role="dialog" aria-label="${esc(title)}"><div class="pp-modal-head"><b>${esc(title)}</b><button type="button" class="secondary small" data-close>${esc(s.apply.close)}</button></div><div class="pp-modal-body legal">${esc(s.live.loading)}</div></div>`;
      document.body.appendChild(box);
      document.body.style.overflow = 'hidden';
      const shut = () => {
        box.remove();
        document.body.style.overflow = '';
      };
      box.addEventListener('click', (ev) => (ev.target === box || ev.target.closest('[data-close]')) && shut());
      try {
        const src = a.dataset.legal;
        let html;
        if (src.startsWith('site:')) {
          // Sitenin kendi sayfası: sadece metin kısmı alınır
          const page = new DOMParser().parseFromString(await (await fetch(`/${LANG === 'tr' ? '' : `${LANG}/`}${src.slice(5)}/`)).text(), 'text/html');
          html = (page.querySelector('article.legal') ?? page.querySelector('main .wrap'))?.innerHTML ?? '';
        } else {
          // Belgeler 9 dilde; bağlayıcı olan Türkçe metindir (GDPR bilgilendirmesi hariç: okuyanın dilinde bilgilendirir)
          html = await (await fetch(`/partners/belge/${LANG === 'tr' ? '' : `${LANG}/`}${src}.html`)).text();
          if (LANG !== 'tr' && src !== 'gdpr') html = `<p class="pp-legal-note">${esc(s.legalNote)}</p>${html}`;
        }
        box.querySelector('.pp-modal-body').innerHTML = html;
      } catch {
        box.querySelector('.pp-modal-body').textContent = s.live.errors.generic;
      }
    }),
  );

  $$('[data-scroll]').forEach((a) =>
    a.addEventListener('click', (e) => {
      e.preventDefault();
      document.getElementById(a.dataset.scroll)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }),
  );
  $('#verify-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = $('#verify-msg');
    const code = e.currentTarget.elements.code.value.trim().toUpperCase();
    if (!code) return;
    let name = null;
    if (SAMPLE) name = code === 'T4K9PZM' ? 'Ayşe K.' : null;
    else {
      const { data } = await live.sb.rpc('partner_rep_check', { p_code: code });
      name = data;
    }
    const nice = (n) => n.replace(/(^|\s)(\S)/g, (m, a, b) => a + b.toLocaleUpperCase('tr'));
    msg.textContent = name ? fmt(s.promo.verifyOk, { name: nice(name) }) : s.promo.verifyBad;
    msg.className = `msg ${name ? 'ok' : 'error'}`;
  });
  $('#corp')?.addEventListener('toggle', (e) => (state.corpOpen = e.currentTarget.open));
  $$('details[data-group]').forEach((d) =>
    d.addEventListener('toggle', () => {
      state.closed[d.dataset.group] = !d.open;
      store('wwp-closed', JSON.stringify(state.closed));
    }),
  );
  $$('[data-theme-toggle]').forEach((b) =>
    b.addEventListener('click', () => {
      setTheme(currentTheme() === 'dark' ? 'light' : 'dark');
      rerender();
    }),
  );
  $('#pp-lang')?.addEventListener('change', (e) => {
    const l = e.target.value;
    // Dil başka bir sayfadır; yazılanlar güvenlik gereği tarayıcıya kaydedilmediği için silinir, önce sorulur
    const typed = [...app.querySelectorAll('#apply-form input:not([type=hidden]):not([type=checkbox]), #apply-form textarea, #rep-form textarea')].some((x) => x.value.trim());
    if (typed && !window.confirm(s.apply.wizard.langChangeWarn)) {
      e.target.value = LANG;
      return;
    }
    store('wwp-dil', l);
    location.href = langPath(l) + location.hash;
  });

  // Yönetici
  $$('[data-doc]').forEach((b) =>
    b.addEventListener('click', () => {
      if (SAMPLE) return alert(s.profile.previewOnly);
      const win = window.open('', '_blank');
      live
        .docUrl(b.dataset.doc)
        .then((u) => (win.location = u))
        .catch((e) => {
          win.close();
          alert(errText(e));
        });
    }),
  );
  $$('[data-decide-app]').forEach((b) =>
    b.addEventListener('click', () => {
      const card = b.closest('[data-app]');
      const rate = Number(card.querySelector('[data-rate]').value);
      const approve = b.dataset.decideApp === '1';
      if (approve && [...card.querySelectorAll('[data-check]')].some((c) => !c.checked)) {
        const m = card.querySelector('[data-amsg]');
        m.textContent = s.adminLive.checklistRequired;
        m.className = 'msg error';
        return;
      }
      // Reddet: önce gerekçe açılır, ikinci basışta gönderilir
      const box = card.querySelector('[data-reject-box]');
      if (!approve && box.hidden) {
        box.hidden = false;
        b.textContent = s.apply.rep.rejectConfirm;
        box.querySelector('[data-reject]').focus();
        return;
      }
      const code = card.querySelector('[data-reject]').value;
      const detail = card.querySelector('[data-reject-detail]').value.trim();
      if (!approve && (!code || (code === 'diger' && detail.length < 5))) {
        const m = card.querySelector('[data-amsg]');
        m.textContent = !code ? s.live.errors.red_gerekcesi : s.live.errors.red_detay;
        m.className = 'msg error';
        return;
      }
      act(b, card.querySelector('[data-amsg]'), async () => {
        const note = [card.querySelector('[data-note]').value, approve ? 'Kontrol listesi tamam' : ''].filter(Boolean).join(' · ');
        await live.decideApplication(card.dataset.app, approve, rate, note || null, approve ? null : code, approve ? null : detail || null);
        await reload();
      });
    }),
  );
  $$('[data-app-tab]').forEach((b) =>
    b.addEventListener('click', () => {
      state.appTab = b.dataset.appTab;
      rerender();
    }),
  );
  // Başvuru kartları: açık olanlar yeniden çizimde açık kalır; temsilcilik metni açılınca okunur
  $$('[data-open-key]').forEach((d) =>
    d.addEventListener('toggle', () => {
      if (d.open) openCards.add(d.dataset.openKey);
      else openCards.delete(d.dataset.openKey);
      const id = d.dataset.repapp;
      if (d.open && id && !repDetails[id] && !SAMPLE) {
        live.repDetail(Number(id)).then((x) => {
          repDetails[id] = x;
          rerender();
        }).catch((e) => (d.querySelector('[data-amsg]').textContent = errText(e)));
      }
    }),
  );
  $$('[data-rep-decide]').forEach((b) =>
    b.addEventListener('click', () => {
      const card = b.closest('[data-repapp]');
      const approve = b.dataset.repDecide === '1';
      const box = card.querySelector('[data-reject-box]');
      if (!approve && box.hidden) {
        box.hidden = false;
        b.textContent = s.apply.rep.rejectConfirm;
        box.querySelector('[data-reject]').focus();
        return;
      }
      const code = card.querySelector('[data-reject]').value;
      const detail = card.querySelector('[data-reject-detail]').value.trim();
      const m = card.querySelector('[data-amsg]');
      if (!approve && (!code || (code === 'diger' && detail.length < 5))) {
        m.textContent = !code ? s.live.errors.red_gerekcesi : s.live.errors.red_detay;
        m.className = 'msg error';
        return;
      }
      act(b, m, async () => {
        await live.repDecide(Number(card.dataset.repapp), approve, approve ? null : code, approve ? null : detail || null);
        await reload();
      });
    }),
  );
  $('#rep-request')?.addEventListener('click', (e) => {
    const m = $('#rep-request-msg');
    act(e.currentTarget, m, async () => {
      await live.repInfo();
      m.textContent = s.apply.rep.requestSent;
    });
  });
  $('#rep-form')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const f = e.currentTarget.elements;
    const msg = $('#rep-msg');
    const E = s.live.errors;
    const problem = f.about.value.trim().length < 10 ? E.temsilci_hakkinda : f.plan.value.trim().length < 10 ? E.temsilci_plan : !f.hours.value ? E.temsilci_sure : !f.accept.checked ? E.temsilci_onay : '';
    if (problem) {
      msg.textContent = problem;
      msg.className = 'msg error';
      return;
    }
    if (SAMPLE) return;
    act(e.currentTarget.querySelector('button[type=submit]'), msg, async () => {
      await live.repApply({ about: f.about.value, experience: f.experience.value, plan: f.plan.value, hours: f.hours.value, accept: true });
      me = await live.me();
      rerender();
      window.scrollTo(0, 0);
    });
  });
  $('#lock-btn')?.addEventListener('click', (e) => {
    const t = new URLSearchParams(location.hash.split('?')[1] || '').get('t') || '';
    const msg = $('#lock-msg');
    if (SAMPLE) return;
    act(e.currentTarget, msg, async () => {
      const ok = await live.emergencyLock(t);
      if (!ok) throw new Error('kilit_yok');
      lockDoneFlag = true;
      history.replaceState(null, '', '#/acil');
      await live.signOut().catch(() => {});
      render();
    });
  });
  $('#punlock')?.addEventListener('click', (e) => {
    if (!confirm(s.apply.rep.unlockConfirm)) return;
    act(e.currentTarget, $('#pmsg'), async () => {
      await live.emergencyUnlock($('#pedit').dataset.id);
      await reload();
    });
  });
  $$('[data-edit]').forEach((b) =>
    b.addEventListener('click', () => {
      state.editPartner = b.dataset.edit;
      rerender();
      window.scrollTo(0, 0);
    }),
  );
  $('#psave')?.addEventListener('click', (e) => {
    const box = $('#pedit');
    const q = (n) => box.querySelector(`[name=${n}]`);
    const patch = {
      status: q('status').value,
      rate: Number(q('rate').value),
      rep_id: q('rep_id').value,
      admin_note: q('admin_note').value,
      is_rep: q('is_rep').checked,
      trial: q('trial').checked,
    };
    act(e.currentTarget, $('#pmsg'), async () => {
      await live.updatePartner(box.dataset.id, patch);
      state.editPartner = null;
      await reload();
    });
  });
  $$('[data-chk]').forEach((b) =>
    b.addEventListener('click', () => {
      const betting = b.dataset.val === 'true';
      const note = betting ? prompt(s.rep.channelNotePrompt) ?? '' : '';
      if (SAMPLE) {
        const p = data.rep.partners.find((x) => x.no === b.dataset.chk);
        if (p) p.check = { betting, note };
        return rerender();
      }
      act(b, null, async () => {
        await live.channelCheck(b.dataset.chk, betting, note);
        await reload();
      });
    }),
  );
  $('#pmfa')?.addEventListener('click', (e) => {
    if (!confirm(s.adminLive.mfaResetConfirm)) return;
    act(e.currentTarget, $('#pmsg'), async () => {
      await live.resetMfa($('#pedit').dataset.id);
      await reload();
      const m = app.querySelector('#pmsg');
      if (m) m.textContent = s.adminLive.mfaResetDone;
    });
  });
  $$('[data-pay]').forEach((b) =>
    b.addEventListener('click', () => {
      const [id, st] = b.dataset.pay.split(':');
      act(b, null, async () => {
        await live.setPayout(Number(id), st);
        await reload();
      });
    }),
  );
  $('#bankfile')?.addEventListener('click', (e) =>
    act(e.currentTarget, null, async () =>
      downloadCsv(
        'winway-partners-banka.csv',
        ['Alıcı', 'IBAN', 'Tutar (TL)', 'Açıklama'],
        (await live.exportPayouts('banka')).map((x) => [x.holder, x.iban, Number(x.net_try).toFixed(2).replace('.', ','), `Winway Partners ${String(x.period).slice(0, 7)}`]),
      ),
    ),
  );
  // Şifreli kişisel veriyi göster: sunucuda kayda geçer
  $$('[data-reveal]').forEach((b) =>
    b.addEventListener('click', () =>
      act(b, null, async () => {
        revealed[b.dataset.reveal] = await live.reveal(b.dataset.reveal);
        rerender();
      }),
    ),
  );
  // Mali müşavire verilen liste: son dönem; şahısa gider pusulası, şirketten fatura (Salih, 2026-11-06)
  $('#taxfile')?.addEventListener('click', (e) =>
    act(e.currentTarget, null, async () => {
      const list = await live.exportPayouts('mali');
      const period = String(list[0]?.period ?? '').slice(0, 7);
      const tl = (v) => Number(v).toFixed(2).replace('.', ',');
      downloadCsv(
        `winway-partners-mali-belge-${period}.csv`,
        ['Dönem', 'Belge', 'Ad soyad / Unvan', 'T.C. kimlik no', 'Vergi dairesi', 'Vergi no', 'MERSİS / Kayıt no', 'Adres', 'Brüt (TL)', 'Kesinti (TL)', 'Net (TL)', 'IBAN', 'Durum'],
        list.map((x) => [String(x.period).slice(0, 7), x.entity_type === 'company' ? 'Fatura (partnerden)' : 'Gider pusulası', x.company_name || x.full_name, x.id_no, x.tax_office, x.tax_no, x.company_reg_no, x.company_address || x.address, tl(x.amount_try), tl(x.withholding_try), tl(x.net_try), x.iban, s.live.payoutStatus[x.status]]),
      );
    }),
  );
  $('#contract-accept')?.addEventListener('click', (e) => {
    const msg = $('#contract-msg');
    if (!$('#contract-ok')?.checked) return void (msg.textContent = s.live.contractNeedCheck);
    act(e.currentTarget, msg, async () => {
      await live.acceptContract(contractVersionNow());
      location.hash = '#/';
      await boot();
    });
  });
  $('#ssave')?.addEventListener('click', (e) => {
    const els = [...app.querySelectorAll('[data-set]')];
    const changes = els
      .map((el) => {
        const k = el.dataset.set;
        const v = el.type === 'checkbox' ? el.checked : el.tagName === 'SELECT' || el.dataset.text ? el.value.trim() : Number(el.value) / Number(el.dataset.mult || 1);
        return [k, v];
      })
      .filter(([k, v]) => JSON.stringify(admin.settings[k]) !== JSON.stringify(v));
    if (changes.some(([k]) => k === 'program_mode') && !confirm(s.adminLive.confirmMode)) return;
    if (changes.some(([k]) => k === 'contract_version') && !confirm(s.adminLive.confirmContract)) return;
    act(e.currentTarget, $('#smsg'), async () => {
      for (const [k, v] of changes) await live.setSetting(k, v);
      await reload();
      const m = app.querySelector('#smsg');
      if (m) m.textContent = s.live.saved;
    });
  });
}

window.addEventListener('hashchange', async () => {
  // Sayfa değişince açık sözleşme penceresi kapanır
  document.querySelectorAll('.pp-modal').forEach((m) => m.remove());
  document.body.style.overflow = '';
  if (!SAMPLE && location.hash === '#/cikis') {
    await live.signOut();
    me = null;
    admin = null;
    data = EMPTY();
    history.replaceState(null, '', '#/giris');
    return boot();
  }
  render();
  window.scrollTo(0, 0);
});
boot();
