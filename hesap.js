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

// ---- Verilerim: uygulamanın ana sayfasındaki veriler + grafikler + 20'şerli kupon listesi ----
// Hesaplar uygulamanın kendi kodundan (src/calculations, src/content/insightTexts; site üreticisi /js/<dil>/ altına çevirir).
const PAGE = 20;
const SVG = 'http://www.w3.org/2000/svg';
const el = (tag, attrs = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) (k === 'class' ? (n.className = v) : n.setAttribute(k, v));
  for (const k of kids.flat()) if (k != null) n.append(k instanceof Node ? k : document.createTextNode(String(k)));
  return n;
};
const svgEl = (tag, attrs = {}) => {
  const n = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
  return n;
};
const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

/** Sayfalı okuma: Supabase bir istekte en çok 1000 satır döndürür */
async function readAll(table, userId, orderBy, ascending) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from(table).select('*').eq('user_id', userId).order(orderBy, { ascending }).range(from, from + 999);
    if (error) throw error;
    rows.push(...(data ?? []));
    if (!data || data.length < 1000) return rows;
  }
}

/** Çizgi grafik (bakiye): kesik çizgi = başlangıç bakiyesi */
function lineChart(points, reference, fmt) {
  const W = 640, H = 200, P = { l: 52, r: 12, t: 12, b: 26 };
  const xs = points.map((p) => p.at), ys = points.map((p) => p.value).concat(reference ?? []);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), yMin = Math.min(...ys), yMax = Math.max(...ys);
  const pad = (yMax - yMin) * 0.08 || Math.max(1, Math.abs(yMax) * 0.05);
  const lo = yMin - pad, hi = yMax + pad;
  const X = (v) => P.l + ((v - x0) / Math.max(x1 - x0, 1)) * (W - P.l - P.r);
  const Y = (v) => P.t + (1 - (v - lo) / (hi - lo)) * (H - P.t - P.b);
  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart', role: 'img' });
  for (let i = 0; i <= 3; i++) {
    const v = lo + ((hi - lo) * i) / 3;
    svg.append(svgEl('line', { x1: P.l, x2: W - P.r, y1: Y(v), y2: Y(v), stroke: css('--border'), 'stroke-width': 1 }));
    const t = svgEl('text', { x: P.l - 6, y: Y(v) + 4, 'text-anchor': 'end', class: 'axis' });
    t.textContent = fmt(v);
    svg.append(t);
  }
  if (reference != null) svg.append(svgEl('line', { x1: P.l, x2: W - P.r, y1: Y(reference), y2: Y(reference), stroke: css('--muted'), 'stroke-dasharray': '5 5' }));
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${X(p.at).toFixed(1)},${Y(p.value).toFixed(1)}`).join('');
  svg.append(svgEl('path', { d: `${d}L${X(x1)},${H - P.b}L${X(x0)},${H - P.b}Z`, fill: css('--green'), opacity: 0.12 }));
  svg.append(svgEl('path', { d, fill: 'none', stroke: css('--green'), 'stroke-width': 2.5, 'stroke-linejoin': 'round' }));
  for (const at of [x0, x1]) {
    const t = svgEl('text', { x: X(at), y: H - 6, 'text-anchor': at === x0 ? 'start' : 'end', class: 'axis' });
    t.textContent = new Date(at).toLocaleDateString(locale, { day: 'numeric', month: 'short' });
    svg.append(t);
  }
  return svg;
}

/** Çubuk grafik: en yüksek değer yeşil, diğerleri soluk; eksi değerler sıfır çizgisinin altında kırmızı (puan) */
function barChart(values, labels, fmt = (v) => v) {
  const W = 640, H = 190, P = { l: 8, r: 8, t: 18, b: 34 };
  const hasNeg = values.some((v) => v < 0);
  const max = Math.max(...values, 0), min = Math.min(...values, 0);
  const span = max - min || 1;
  const Y = (v) => P.t + ((max - v) / span) * (H - P.t - P.b - (hasNeg ? 14 : 0));
  const zero = Y(0);
  const top = values.indexOf(max);
  const bw = (W - P.l - P.r) / values.length;
  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart', role: 'img' });
  if (hasNeg) svg.append(svgEl('line', { x1: P.l, x2: W - P.r, y1: zero, y2: zero, stroke: css('--border'), 'stroke-width': 1 }));
  values.forEach((v, i) => {
    const x = P.l + i * bw + bw * 0.15;
    const y = Math.min(Y(v), zero), h = Math.abs(Y(v) - zero);
    const color = v < 0 ? css('--red') : i === top && v > 0 ? css('--green') : css('--surface-high');
    svg.append(svgEl('rect', { x, y, width: bw * 0.7, height: Math.max(h, v ? 2 : 0), rx: 4, fill: color }));
    const n = svgEl('text', { x: x + bw * 0.35, y: v < 0 ? zero + h + 13 : zero - h - 5, 'text-anchor': 'middle', class: 'val' });
    n.textContent = v ? fmt(v) : '';
    svg.append(n);
    const l = svgEl('text', { x: x + bw * 0.35, y: H - 12, 'text-anchor': 'middle', class: 'axis' });
    l.textContent = labels[i];
    svg.append(l);
  });
  return svg;
}

/** Halka grafik (kupon sonuçları) */
function donut(parts) {
  const total = parts.reduce((a, p) => a + p.value, 0);
  const R = 52, C = 2 * Math.PI * R;
  const svg = svgEl('svg', { viewBox: '0 0 140 140', class: 'donut', role: 'img' });
  svg.append(svgEl('circle', { cx: 70, cy: 70, r: R, fill: 'none', stroke: css('--surface-high'), 'stroke-width': 18 }));
  let off = 0;
  for (const p of parts) {
    if (!p.value) continue;
    const len = (p.value / total) * C;
    svg.append(svgEl('circle', { cx: 70, cy: 70, r: R, fill: 'none', stroke: p.color, 'stroke-width': 18, 'stroke-dasharray': `${len} ${C - len}`, 'stroke-dashoffset': -off, transform: 'rotate(-90 70 70)' }));
    off += len;
  }
  const t = svgEl('text', { x: 70, y: 76, 'text-anchor': 'middle', class: 'donut-total' });
  t.textContent = String(total);
  svg.append(t);
  return svg;
}

/** Kartı doldurur; boş (null) parçalar atlanır */
const fillCard = (id, ...kids) => $(id).replaceChildren(...kids.flat().filter((k) => k != null));

const box = (label, value, color, note) =>
  el('div', { class: 'stat' }, el('b', color ? { style: `color:${color}` } : {}, value), el('span', {}, label), note ? el('small', color ? { style: `color:${color}` } : {}, note) : null);

async function showMyData(user, profile) {
  const base = `/js/${W.lang}`;
  const [I, B, X, F, D, TX] = await Promise.all([
    import(`${base}/calculations/behaviorInsights.mjs`),
    import(`${base}/calculations/behavior.mjs`),
    import(`${base}/features/awareness/insightFormat.mjs`),
    import(`${base}/utils/format.mjs`),
    import(`${base}/utils/date.mjs`),
    import(`${base}/content/insightTexts.mjs`),
  ]);
  const T = TX.insightTexts;
  const fill = TX.fill;
  const m = s.myData;

  const [couponRows, ledgerRows] = await Promise.all([readAll('coupons', user.id, 'created_at', false), readAll('coin_ledger', user.id, 'id', true)]);
  // Uygulamadaki dönüşümün aynısı (src/features/coupon/serverBackend.ts toCoupon / toLedger)
  const coupons = couponRows.map((r) => ({
    id: r.id, createdAt: r.created_at, settledAt: r.settled_at ?? undefined, stake: Number(r.stake), totalOdds: Number(r.total_odds),
    status: r.status, payout: Number(r.payout), selections: Array.isArray(r.selections) ? r.selections : [],
    ...(r.points != null && r.status !== 'pending' ? { points: Number(r.points) } : {}),
    ...(r.hold_until ? { holdUntil: r.hold_until, holdChecked: r.hold_checked ?? true } : {}),
  }));
  const ledger = ledgerRows.map((r) => ({ id: String(r.id), at: r.at, type: r.type, amount: Number(r.amount), balanceAfter: Number(r.balance_after), couponId: r.coupon_id ?? undefined }));
  const history = { coupons, ledger };
  const now = Date.now();
  const snapshot = B.decisionSnapshotTime(new Date(now));
  const insights = I.computeInsights(history, () => undefined, snapshot);
  const balance = I.balanceView(ledger, now, coupons);
  const stats = I.myStats(history, now);
  const updated = fill(T.budget.updated, { time: `${D.dayLabel(snapshot)} ${D.timeOf(snapshot)}` });
  const n0 = (v) => F.formatNumber(v, 0);

  // Özet kutuları
  const count = (st) => coupons.filter((c) => c.status === st).length;
  const start = monthStartTr();
  const monthSettled = coupons.filter((c) => c.status !== 'pending' && c.points != null && c.settledAt && Date.parse(c.settledAt) >= start);
  const monthPoints = monthSettled.reduce((a, c) => a + c.points, 0);
  $('d-balance').textContent = `₵${n0(balance.current)}`;
  $('d-points').textContent = F.formatNumber(monthPoints, 2);
  $('d-coupons').textContent = n0(coupons.length);
  $('d-won').textContent = n0(count('won'));
  $('d-lost').textContent = n0(count('lost'));
  $('d-void').textContent = n0(count('void'));
  $('d-pending').textContent = n0(count('pending'));

  // 1) Bütçe Kontrolü
  const change = balance.current - balance.start;
  const pct = balance.start ? (change / balance.start) * 100 : null;
  const changeColor = change > 0 ? css('--green') : change < 0 ? css('--red') : null;
  const used = balance.start ? Math.min(Math.max(balance.current / balance.start, 0), 1) : 0;
  const weekly = insights.weekly;
  const patterns = [...weekly.patterns].reverse();
  const patternEl = (p) =>
    el('div', { class: `pattern ${p.kind}` }, el('b', {}, X.patternTitle(p)), ...X.patternFollowUp(p).map((l) => el('div', { class: 'muted' }, l)),
      el('small', { class: 'muted' }, `${D.dayLabel(new Date(p.at))} ${D.timeOf(new Date(p.at))}`));
  fillCard('c-budget', 
    el('h2', {}, T.cards.budgetTitle),
    el('div', { class: 'stats three' }, box(T.budget.start, n0(balance.start)), box(T.budget.current, n0(balance.current)),
      box(T.budget.change, `${change > 0 ? '+' : change < 0 ? '−' : ''}${n0(Math.abs(change))}`, changeColor, pct === null ? null : F.formatPercent(pct, 1, 'always'))),
    el('div', { class: 'meter', title: `${n0(balance.current)} / ${n0(balance.start)}` }, el('span', { style: `width:${(used * 100).toFixed(1)}%` })),
    balance.chart.length > 1 ? lineChart(balance.chart.map((p) => ({ at: p.at, value: p.balance })), balance.start, (v) => F.formatCompact(v)) : null,
    balance.chart.length > 1 ? el('p', { class: 'muted small' }, T.budget.chartNote) : null,
    el('h3', {}, T.weekly.title),
    el('div', { class: 'stats two' },
      box(T.weekly.coupons, String(weekly.current.coupons), null, fill(T.weekly.previous, { value: String(weekly.previous.coupons) })),
      box(T.weekly.avgRatio, X.ratioText(weekly.current.avgRatio), null, fill(T.weekly.previous, { value: X.ratioText(weekly.previous.avgRatio) }))),
    weekly.current.coupons === 0 ? el('p', { class: 'muted' }, T.weekly.noCoupons) : null,
    el('h3', {}, T.weekly.patternsTitle),
    patterns.length ? el('div', { class: 'patterns' }, patterns.map(patternEl)) : el('p', { class: 'muted' }, T.weekly.noPatterns),
    el('p', { class: 'muted small' }, updated),
  );

  // 2) Karar Analizi
  const busiest = (list) => { const t = [...list].sort((a, b) => b.coupons - a.coupons)[0]; return t && t.coupons > 0 ? t : null; };
  const day = busiest(insights.slots.days), hour = busiest(insights.slots.hours);
  const sentences = X.slotSentences(insights.slots);
  const anyEnough = [...insights.slots.days, ...insights.slots.hours].some((x) => x.enough);
  const status = X.baselineStatus(insights.baseline, (ms) => D.dayLabel(new Date(ms), undefined, 'tr'));
  const baseLines = X.baselineLines(insights.baseline);
  const changedBase = baseLines.filter((l) => l.changed);
  const hourShort = (slot) => `${String(slot * 3).padStart(2, '0')}–${String(slot * 3 + 3).padStart(2, '0')}`;
  fillCard('c-decision', 
    el('h2', {}, T.cards.decisionTitle),
    el('div', { class: 'stats two' }, box(T.cards.mostActiveDay, day ? X.DAY_NAMES[day.slot] : '—'), box(T.cards.mostActiveHour, hour ? X.hourSlotLabel(hour.slot) : '—')),
    el('h3', {}, `${T.slots.dayTitle} · ${T.slots.window}`),
    barChart(insights.slots.days.map((x) => x.coupons), insights.slots.days.map((x) => D.WEEKDAYS_SHORT[x.slot] ?? X.DAY_NAMES[x.slot].slice(0, 3))),
    el('h3', {}, `${T.slots.hourTitle} · ${T.slots.window}`),
    barChart(insights.slots.hours.map((x) => x.coupons), insights.slots.hours.map((x) => hourShort(x.slot))),
    ...(sentences.length ? sentences.map((x) => el('p', {}, x)) : [el('p', { class: 'muted' }, anyEnough ? T.slots.noneChanged : X.MIN_SLOT_TEXT)]),
    el('h3', {}, T.baseline.title),
    ...(status ? [el('p', { class: 'muted' }, status)] : (changedBase.length ? changedBase : baseLines).map((l) => el('p', l.changed ? {} : { class: 'muted' }, l.text))),
    el('p', { class: 'muted small' }, updated),
  );

  // 3) İstatistiklerim
  const pending = count('pending');
  const parts = [
    { label: T.stats.won, value: stats.won, color: css('--green') },
    { label: T.stats.lost, value: stats.lost, color: css('--red') },
    { label: T.stats.void, value: stats.void, color: css('--yellow') },
    { label: m.pending, value: pending, color: css('--muted') },
  ];
  fillCard('c-stats', 
    el('h2', {}, m.statsTitle),
    el('div', { class: 'stats' },
      box(T.stats.winRate, stats.winRate == null ? '—' : F.formatPercent(stats.winRate)),
      box(T.stats.roi, stats.roi == null ? '—' : F.formatPercent(stats.roi, 1, 'always'), stats.roi > 0 ? css('--green') : stats.roi < 0 ? css('--red') : null),
      box(T.stats.avgOdds, stats.avgOdds == null ? '—' : F.formatNumber(stats.avgOdds, 2)),
      box(T.stats.net, `${stats.net > 0 ? '+' : stats.net < 0 ? '−' : ''}${n0(Math.abs(stats.net))}`, stats.net > 0 ? css('--green') : stats.net < 0 ? css('--red') : null, T.stats.netNote)),
    el('h3', {}, m.resultsChart),
    el('div', { class: 'donut-row' }, donut(parts),
      el('ul', { class: 'legend' }, parts.map((p) => el('li', {}, el('i', { style: `background:${p.color}` }), `${p.label}: ${n0(p.value)}`)))),
    el('p', { class: 'muted small' }, T.stats.note),
  );

  // 4) Puan gelişimi: bu ay günlere göre kazanılan puan (Türkiye takvimi)
  const trDay = (ms) => new Date(ms + 3 * 3600000).getUTCDate();
  const today = trDay(now);
  const perDay = Array.from({ length: today }, () => 0);
  for (const c of monthSettled) perDay[trDay(Date.parse(c.settledAt)) - 1] += c.points;
  fillCard('c-points', 
    el('h2', {}, T.cards.pointsTitle),
    el('p', { class: 'muted' }, `${m.monthPoints}: ${F.formatNumber(monthPoints, 2)}`),
    barChart(perDay.map((v) => Math.round(v * 100) / 100), perDay.map((_, i) => (today > 16 && i % 2 ? '' : String(i + 1))), (v) => F.formatCompact(v)),
    el('p', { class: 'muted small' }, T.cards.pointsDailyNote),
  );

  // 5) Geçmiş kuponlar: 20'şer
  let shown = 0;
  const body = $('d-rows');
  body.innerHTML = '';
  const addRows = () => {
    for (const c of coupons.slice(shown, shown + PAGE)) {
      const tr = el('tr', { class: 'coupon-row', tabindex: '0' },
        el('td', {}, dateTime(c.createdAt)), el('td', {}, String(c.selections.length)), el('td', {}, F.formatNumber(c.totalOdds, 2)),
        el('td', {}, `₵${n0(c.stake)}`), el('td', { class: `st-${c.status}` }, s.status[c.status] ?? c.status),
        el('td', {}, c.status === 'pending' ? '–' : `₵${F.formatNumber(c.payout, 2)}`), el('td', {}, c.points == null ? '–' : F.formatNumber(c.points, 2)));
      const detail = el('tr', { class: 'coupon-detail', hidden: '' },
        el('td', { colspan: '7' }, el('table', { class: 'inner' },
          el('thead', {}, el('tr', {}, m.detailCols.map((h) => el('th', {}, h)))),
          el('tbody', {}, c.selections.map((x) => el('tr', {},
            el('td', {}, x.matchLabel ?? ''), el('td', {}, [x.marketLabel, x.pickLabel].filter(Boolean).join(' · ')),
            el('td', {}, F.formatNumber(Number(x.odds), 2)), el('td', { class: `st-${x.result}` }, `${s.status[x.result] ?? x.result}${x.score ? ` (${x.score})` : ''}`)))))));
      const toggle = () => { detail.hidden = !detail.hidden; tr.classList.toggle('open', !detail.hidden); };
      tr.addEventListener('click', toggle);
      tr.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
      body.append(tr, detail);
    }
    shown = Math.min(shown + PAGE, coupons.length);
    $('d-shown').textContent = fmt(m.shown, { shown: n0(shown), total: n0(coupons.length) });
    $('d-more').hidden = shown >= coupons.length;
  };
  $('d-more').onclick = addRows;
  addRows();
  $('d-empty').hidden = coupons.length > 0;
  $('d-table').hidden = coupons.length === 0;
  $('d-list-info').hidden = coupons.length === 0;

  $('d-download').onclick = () => {
    const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), email: user.email, profile, coupons: couponRows, coinLedger: ledgerRows }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `winwaystats-${profile?.username ?? 'veriler'}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  $('d-loading').hidden = true;
  $('d-content').hidden = false;

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
