// Winway Partners önizlemesi için örnek veri. Sabit tohumla üretilir: her açılışta aynı rakamlar.
// Gerçek veri Parça 3'te sunucudan gelir; ekranlar sadece panel.js'teki `api` üzerinden okur.

const DAY = 86400000;
const PRICES = {
  // paket, dönem, fiyat (TL), dönem gün sayısı
  'starter-haftalik': { plan: 'starter', period: 'weekly', price: 773, days: 7 },
  'pro-aylik': { plan: 'pro', period: 'monthly', price: 1505, days: 30 },
  'premium-6ay': { plan: 'premium', period: 'sixMonth', price: 6950, days: 182 },
  'master-yillik': { plan: 'master', period: 'yearly', price: 15050, days: 365 },
};
const TAX = 0.1667; // KDV payı (fiyatın içinden)
const STORE_CUT = 0.15; // mağaza kesintisi
const RATE = 0.1; // partner oranı

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const round2 = (v) => Math.round(v * 100) / 100;
const startOfDay = (t) => {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

export function buildSample(now = Date.now()) {
  const r = rng(20261022);
  const pick = (arr) => arr[Math.floor(r() * arr.length)];
  const today = startOfDay(now);
  const joined = today - 150 * DAY;

  const campaigns = [
    { name: 'telegram-ana', code: 'WWTELE', createdAt: joined + 2 * DAY, weight: 0.55 },
    { name: 'youtube', code: 'WWYT24', createdAt: joined + 40 * DAY, weight: 0.3 },
    { name: 'default', code: 'WW38204', createdAt: joined, weight: 0.15 },
  ];

  // Günlük tıklamalar (150 gün), kampanyaya göre
  const clicks = [];
  for (let d = 0; d <= 150; d++) {
    const day = joined + d * DAY;
    for (const c of campaigns) {
      if (day < startOfDay(c.createdAt)) continue;
      const base = 18 + d * 0.35;
      const n = Math.max(0, Math.round(base * c.weight * (0.6 + r() * 0.8)));
      if (n) clicks.push({ day, campaign: c.name, n });
    }
  }

  // Kullanıcılar: tıklamaların ~%9'u kayıt olur
  const countries = ['TR', 'TR', 'TR', 'TR', 'TR', 'TR', 'TR', 'DE', 'AZ', 'NL', 'CY'];
  const products = ['pro-aylik', 'pro-aylik', 'pro-aylik', 'pro-aylik', 'master-yillik', 'premium-6ay'];
  const users = [];
  const usedAccounts = new Set();
  for (const c of clicks) {
    for (let i = 0; i < c.n; i++) {
      if (r() > 0.09) continue;
      let account;
      do account = String(100000000 + Math.floor(r() * 899999999));
      while (usedAccounts.has(account));
      usedAccounts.add(account);
      const registeredAt = c.day + Math.floor(r() * DAY);
      const u = { account, campaign: c.campaign, registeredAt, country: pick(countries), product: null, subStart: null, cancelAt: null };
      if (r() < 0.32) {
        u.product = pick(products);
        u.subStart = Math.min(now - DAY, registeredAt + Math.floor(r() * 9) * DAY + 3600000);
        if (r() < 0.22) u.cancelAt = u.subStart + (1 + Math.floor(r() * 4)) * PRICES[u.product].days * DAY - DAY;
        if (u.cancelAt && u.cancelAt > now) u.cancelAt = null;
      }
      users.push(u);
    }
  }

  // Ödemeler ve komisyonlar: abonelik başlangıcından iptale ya da bugüne kadar her dönem başında bir ödeme
  const commissions = [];
  for (const u of users) {
    if (!u.product) continue;
    const p = PRICES[u.product];
    const end = u.cancelAt ?? now;
    for (let t = u.subStart; t <= end; t += p.days * DAY) {
      const company = round2(p.price * (1 - TAX) * (1 - STORE_CUT));
      const refunded = r() < 0.015;
      commissions.push({
        at: t,
        account: u.account,
        campaign: u.campaign,
        product: u.product,
        gross: p.price,
        company,
        rate: RATE,
        amount: round2(company * RATE),
        refunded,
      });
    }
  }
  commissions.sort((a, b) => a.at - b.at);

  // Geçmiş ödemeler: her ayın 18'i, 30 günü dolmuş ve alt limiti geçen bakiye
  const MIN = 1000;
  const payouts = [];
  let paidUntil = 0;
  const cursor = new Date(joined);
  cursor.setDate(18);
  cursor.setHours(10, 0, 0, 0);
  if (cursor.getTime() < joined) cursor.setMonth(cursor.getMonth() + 1);
  while (cursor.getTime() <= now) {
    const payDay = cursor.getTime();
    const ripe = commissions.filter((c) => !c.refunded && c.at + 30 * DAY <= payDay && c.at > paidUntil);
    const sum = round2(ripe.reduce((s, c) => s + c.amount, 0));
    if (sum >= MIN) {
      const prev = new Date(payDay);
      prev.setMonth(prev.getMonth() - 1);
      payouts.push({ at: payDay, amount: sum, periodFrom: paidUntil || joined, periodTo: payDay - 30 * DAY });
      for (const c of ripe) c.paid = true;
      paidUntil = payDay - 30 * DAY;
    }
    cursor.setMonth(cursor.getMonth() + 1);
  }
  for (const c of commissions) {
    if (c.refunded) c.status = 'refunded';
    else if (c.paid) c.status = 'paid';
    else if (c.at + 30 * DAY <= now) c.status = 'available';
    else c.status = 'pending';
  }

  // Üyelik ödemesi (tek seferlik 20 ₺): 90 günün en az 68'inde ≥ 2 dk + üç 30 günlük dönemin her birinde ≥ 3 kupon günü
  const r2 = rng(99);
  const BONUS = 20;
  for (const u of users) {
    const age = Math.min(90, Math.floor((now - u.registeredAt) / DAY));
    const keen = r2() < 0.18; // düzenli kullananlar
    const rate = keen ? 0.78 + r2() * 0.2 : 0.1 + r2() * 0.55;
    u.activeDays = Math.min(age, Math.round(age * rate));
    u.couponPeriods = Math.min(Math.ceil(age / 30), keen ? 3 : Math.floor(r2() * 3));
    const missed = age - u.activeDays;
    if (age >= 90) u.member = u.activeDays >= 68 && u.couponPeriods >= 3 ? 'qualified' : 'failed';
    else u.member = 90 - age >= 68 - u.activeDays && missed <= 22 ? 'tracking' : 'failed';
    if (u.member === 'qualified') u.memberPaidAt = u.registeredAt + 90 * DAY;
  }

  // Partner Temsilcisi: bu hesap aynı zamanda 10 partnerin temsilcisi (bir kişi hem partner hem temsilci olabilir)
  const channels = [
    ['Gol Analiz TV', 'Telegram', 1800], ['Banko Yorum', 'Telegram', 1500], ['Futbol Masası', 'YouTube', 1300], ['Derbi Notları', 'Telegram', 1100],
    ['Taktik Saati', 'YouTube', 1000], ['Maç Önü', 'Instagram', 900], ['Kupon Kulübü', 'Telegram', 800], ['Lig Radarı', 'X', 700],
    ['İstatistik Dünyası', 'Telegram', 500], ['Gece Maçları', 'Telegram', 400],
  ];
  const repPartners = channels.map(([name, channel, users], i) => {
    const conv = 0.08 + (r() - 0.5) * 0.04;
    const activeSubs = Math.round(users * conv);
    const monthRevenue = round2(activeSubs * PRICES['pro-aylik'].price * (1 - TAX) * (1 - STORE_CUT));
    return {
      name,
      channel,
      users,
      activeSubs,
      monthRevenue,
      status: i === 9 ? 'review' : 'active',
      linkedBy: i < 7 ? 'invite' : 'auto',
      joinedAt: joined + (10 + i * 9) * DAY,
      lastSignupAt: now - Math.floor(r() * (i === 8 ? 40 : 6)) * DAY,
      no: String(400000 + i * 137),
      check: i === 3 ? { betting: true, note: 'Sabitlenmiş mesajda bahis sitesi bağlantısı' } : i < 6 ? { betting: false } : null,
    };
  });
  const totalActive = repPartners.reduce((a, p) => a + p.activeSubs, 0);
  const rep = {
    inviteCode: 'TMS382',
    partners: repPartners,
    activeSubs: totalActive,
    avg3: Math.round(totalActive * 0.86),
    history: [0.55, 0.7, 0.86, 1].map((f) => round2(totalActive * f * PRICES['pro-aylik'].price * (1 - TAX) * (1 - STORE_CUT))),
  };
  const repTiers = [
    { from: 0, rate: 0.02 },
    { from: 300, rate: 0.025 },
    { from: 1000, rate: 0.03 },
    { from: 2500, rate: 0.04 },
  ];

  // Yönetici bölümü: temsilci göstergeleri (son 30 gün)
  const reps = [
    { name: 'Ayşe Kaya', partners: 14, newPartners: 3, activeRatio: 0.79, onboarding: 0.83, satisfaction: 4.6, lastLogin: now - 0.2 * DAY, activeSubs: 1240, autoAssign: true },
    { name: 'Ömer Demir', partners: 10, newPartners: 1, activeRatio: 0.9, onboarding: 1, satisfaction: 4.8, lastLogin: now - 1 * DAY, activeSubs: 1077, autoAssign: true },
    { name: 'Selin Arslan', partners: 7, newPartners: 2, activeRatio: 0.57, onboarding: 0.5, satisfaction: 3.9, lastLogin: now - 3 * DAY, activeSubs: 410, autoAssign: true },
    { name: 'Burak Yıldız', partners: 5, newPartners: 0, activeRatio: 0.6, onboarding: 0.67, satisfaction: 3.4, lastLogin: now - 9 * DAY, activeSubs: 205, autoAssign: true },
    { name: 'Kaan Öztürk', partners: 6, newPartners: 0, activeRatio: 0.33, onboarding: 0, satisfaction: 2.6, lastLogin: now - 41 * DAY, activeSubs: 96, autoAssign: false, passiveDays: 64 },
    { name: 'Deniz Çelik', partners: 3, newPartners: 0, activeRatio: 0.67, onboarding: null, satisfaction: 1.8, lastLogin: now - 12 * DAY, activeSubs: 58, autoAssign: false, passiveDays: 21 },
  ];

  // Yönetici bölümü örneği (gerçek moddaki loadAdmin ile aynı biçim)
  const adminPartners = channels.map(([name, channel], i) => ({
    id: `p${i}`,
    partner_no: String(310000 + i * 1371),
    status: i === 9 ? 'application' : i === 8 ? 'suspended' : 'approved',
    rate: i < 2 ? 0.12 : 0.1,
    is_rep: i === 0,
    rep_rate: 0.025,
    rep_id: i === 0 ? null : 'p0',
    rep_linked_by: i < 7 ? 'invite' : 'auto',
    rep_auto_assign: true,
    trial: i < 3,
    created_at: new Date(joined + (10 + i * 9) * DAY).toISOString(),
    admin_note: '',
    priv: {
      full_name: name,
      id_no: '1234567890' + i,
      birth_date: '1990-04-1' + i,
      phone: '555 000 00 0' + i,
      country: 'TR',
      address: 'Örnek Mah. Örnek Sok. No:' + (i + 1) + ' İstanbul',
      entity_type: 'person',
      tax_no: null,
      followers: 5000 + i * 1300,
      channel_links: `https://t.me/${name.toLowerCase().replace(/[^a-z]/g, '')}`,
      id_doc_path: 'ornek/on.jpg',
      id_doc_back_path: 'ornek/arka.jpg',
    },
    account: { iban: `TR33000640000011234567890${i}`, holder: name },
    balance: { available: Math.round(1800 + r() * 9000), pending: Math.round(900 + r() * 4000) },
  }));
  const adminName = Object.fromEntries(adminPartners.map((p) => [p.id, p.priv.full_name]));
  const adminSample = {
    partners: adminPartners,
    name: adminName,
    payouts: adminPartners.filter((p) => p.status === 'approved').slice(0, 5).map((p, i) => ({
      id: i + 1,
      partner_id: p.id,
      name: p.priv.full_name,
      period: '2026-10-01',
      amount_try: p.balance.available,
      withholding_try: 0,
      net_try: p.balance.available,
      iban: p.account.iban,
      holder: p.account.holder,
      status: i < 2 ? 'paid' : 'listed',
    })),
    settings: {
      program_mode: 'off',
      program_access: 'staff',
      default_rate: 0.1,
      min_payout_try: 1000,
      member_bonus_try: 20,
      member_bonus_monthly_cap: 500,
      foreign_payouts_open: false,
      rep_tiers: [{ from: 0, rate: 0.02 }, { from: 300, rate: 0.025 }, { from: 1000, rate: 0.03 }, { from: 2500, rate: 0.04 }],
      fx_usd_try: 49.6278,
    },
    feedback: [],
    checks: [
      { partner_id: 'p3', month: '2026-10-01', betting_ads: true, note: 'Sabitlenmiş mesajda bahis sitesi bağlantısı', checked_at: new Date(now - 2 * DAY).toISOString() },
      { partner_id: 'p3', month: '2026-09-01', betting_ads: false, note: null, checked_at: new Date(now - 33 * DAY).toISOString() },
      { partner_id: 'p1', month: '2026-10-01', betting_ads: false, note: null, checked_at: new Date(now - 4 * DAY).toISOString() },
    ],
  };

  const nextPay = new Date(now);
  if (nextPay.getDate() >= 18) nextPay.setMonth(nextPay.getMonth() + 1);
  nextPay.setDate(18);

  return {
    now,
    joined,
    rate: RATE,
    rateMax: 0.2,
    minPayout: MIN,
    nextPayout: nextPay.getTime(),
    prices: PRICES,
    campaigns,
    clicks,
    users,
    commissions,
    payouts,
    adminSample,
    memberBonus: BONUS,
    // Temsilciye düşen hile işaretleri (önizleme)
    flags: [
      { id: 1, partner: 'Kupon Kulübü', kind: 'noSubs', at: now - 2 * DAY, members: 64, subRate: 0, sameDevice: 0, pattern: 0.31, held: 64 * BONUS },
      { id: 2, partner: 'Lig Radarı', kind: 'pattern', at: now - 5 * DAY, members: 38, subRate: 0.03, sameDevice: 0, pattern: 0.82, held: 38 * BONUS },
      { id: 3, partner: 'Gece Maçları', kind: 'device', at: now - 9 * DAY, members: 12, subRate: 0.08, sameDevice: 7, pattern: 0.4, held: 12 * BONUS, overdue: true },
    ],
    rep,
    repTiers,
    reps,
    myRep: { name: 'Ayşe Kaya', telegram: '@ayse_winway', email: 'ayse.kaya@winway.com.tr', since: joined + 2 * DAY },
    profile: {
      partnerId: '382049',
      username: 'ornekpartner',
      fullName: 'Örnek Partner',
      email: 'ornek@winwaystats.com',
      country: 'Türkiye',
      language: 'Türkçe',
      iban: 'TR33 0006 4000 0011 2345 6789 01',
      holder: 'Örnek Partner',
      ibanSince: joined + 3 * DAY,
      contractAt: joined,
      contractVersion: '1.0',
      domestic: true,
      status: 'active',
    },
  };
}
