// Winway Partners paneli: gerçek veri (Supabase). Ekranlar örnek veriyle (sample.js) aynı biçimdeki `data` nesnesini okur;
// bu dosya sunucudan okuyup o biçime çevirir. Partner kendi tablolarını RLS ile (iki adımlı doğrulamalı oturum) okur;
// getirdiği kullanıcılar, tıklamalar, temsilci listeleri kişisel veri döndürmeyen sunucu fonksiyonlarından gelir.
// Supabase istemcisi sayfada tek dosya olarak yüklenir (/partners/supabase.js; web-sitesi.mjs paketten kopyalar)
const { createClient } = window.supabase;

const DAY = 86400000;
const n = (v) => Number(v ?? 0);
const ts = (v) => (v ? Date.parse(v) : null);

// Defter durumu → ekran durumu (örnek veriyle aynı adlar)
const STATUS = { pending: 'pending', frozen: 'pending', available: 'available', in_payout: 'paid', paid: 'paid', cancelled: 'refunded' };
const PARTNER_STATUS = { approved: 'active', application: 'review', suspended: 'suspended', terminated: 'suspended', rejected: 'suspended' };

export function createLive(W) {
  const sb = createClient(W.url, W.key, { auth: { persistSession: true, autoRefreshToken: true } });
  const ok = ({ data, error }) => {
    if (error) throw error;
    return data;
  };
  const rpc = async (fn, args) => ok(await sb.rpc(fn, args));

  const live = {
    sb,
    async session() {
      return (await sb.auth.getSession()).data.session;
    },
    async signIn(email, password, captchaToken) {
      const { error } = await sb.auth.signInWithPassword({ email, password, options: { captchaToken: captchaToken ?? undefined } });
      if (error) throw error;
    },
    signOut: () => sb.auth.signOut(),
    async requestReset(email, captchaToken) {
      ok(await sb.auth.resetPasswordForEmail(email, { captchaToken: captchaToken ?? undefined }));
    },
    async verifyReset(email, token) {
      ok(await sb.auth.verifyOtp({ email, token, type: 'recovery' }));
    },
    async updatePassword(password) {
      ok(await sb.auth.updateUser({ password }));
    },
    me: () => rpc('partner_me'),

    // ---- İki adımlı doğrulama (TOTP) ----
    async mfa() {
      const level = ok(await sb.auth.mfa.getAuthenticatorAssuranceLevel());
      const factors = ok(await sb.auth.mfa.listFactors());
      return { current: level.currentLevel, verified: factors.totp?.find((f) => f.status === 'verified') ?? null, all: factors.all ?? [] };
    },
    async enroll() {
      // Yarım kalmış (doğrulanmamış) kurulumlar silinir; aynı adla yeniden kurulabilsin
      const factors = ok(await sb.auth.mfa.listFactors());
      for (const f of factors.all ?? []) if (f.status !== 'verified') await sb.auth.mfa.unenroll({ factorId: f.id });
      return ok(await sb.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'Winway Partners', issuer: 'Winway Partners' }));
    },
    async verify(factorId, code) {
      ok(await sb.auth.mfa.challengeAndVerify({ factorId, code }));
      await sb.auth.refreshSession();
    },

    // ---- Başvuru ----
    apply: (fields) => rpc('partner_apply', { p: fields }),

    // ---- Partner işlemleri ----
    createCampaign: (name) => rpc('partner_campaign_create', { p_name: name }),
    changeIban: (iban, holder) => rpc('partner_change_iban', { p_iban: iban, p_holder: holder }),
    rateRep: (score) => rpc('partner_rate_rep', { p_score: score }),
    requestRepChange: (note) => rpc('partner_request_rep_change', { p_note: note }),
    decideFlag: (id, decision, note) => rpc('rep_decide_flag', { p_id: id, p_decision: decision, p_note: note }),
    channelCheck: (no, betting, note) => rpc('rep_channel_check', { p_partner_no: no, p_betting: betting, p_note: note }),

    // ---- Partner verisi (örnek veriyle aynı biçim) ----
    async loadPartner(me) {
      const session = await live.session();
      const uid = session.user.id;
      const p = ok(await sb.from('partners').select('*').eq('user_id', uid).single());
      const joined = ts(p.approved_at) ?? ts(p.created_at);
      const [priv, acct, camps, ledger, payouts, users, clicks, myRep, prof] = await Promise.all([
        sb.from('partner_private').select('partner_id,full_name,country,entity_type').eq('partner_id', p.id).maybeSingle().then(ok),
        sb.from('partner_payout_accounts').select('iban_son4,holder,bank_name,bank_country,swift_bic,bank_code,created_at').eq('partner_id', p.id).eq('active', true).maybeSingle().then(ok),
        sb.from('partner_campaigns').select('*').eq('partner_id', p.id).order('created_at').then(ok),
        sb.from('partner_ledger').select('*').eq('partner_id', p.id).order('created_at').limit(20000).then(ok),
        sb.from('partner_payouts').select('id,period,amount_try,withholding_try,net_try,iban_son4,holder,status,created_at,approved_at,paid_at').eq('partner_id', p.id).order('created_at', { ascending: false }).then(ok),
        rpc('partner_my_users'),
        rpc('partner_my_clicks', { p_from: new Date(joined - DAY).toISOString(), p_to: new Date().toISOString() }),
        rpc('partner_my_rep'),
        sb.from('profiles').select('username').eq('id', uid).maybeSingle().then(ok),
      ]);
      const st = me.settings ?? {};
      const now = Date.now();
      const isRepRow = (l) => l.kind === 'rep_share' || (l.kind === 'reversal' && l.source_partner_id);
      const toRow = (l) => ({
        at: ts(l.created_at),
        account: null,
        campaign: null,
        kind: l.kind,
        company: (l.kind === 'reversal' ? -1 : 1) * n(l.base_try),
        amount: n(l.amount_try),
        status: STATUS[l.status] ?? 'pending',
        refunded: l.status === 'cancelled',
      });
      const payDay = n(st.payout_day) || 18;
      const next = new Date(now);
      if (next.getDate() >= payDay) next.setMonth(next.getMonth() + 1);
      next.setDate(payDay);

      const data = {
        live: true,
        now,
        joined,
        rate: n(p.rate),
        rateMax: n(st.max_rate) || 0.2,
        minPayout: n(st.min_payout_try) || 1000,
        nextPayout: next.getTime(),
        prices: {},
        memberBonus: n(st.member_bonus_try) || 20,
        repTiers: Array.isArray(st.rep_tiers) ? st.rep_tiers : [],
        campaigns: camps.map((c) => ({ name: c.name, code: c.code, createdAt: ts(c.created_at) })),
        clicks: clicks.map((c) => ({ day: Date.parse(`${c.day}T00:00:00`), campaign: c.campaign, n: n(c.clicks) })),
        users: users.map((u) => ({
          account: u.account_no,
          campaign: u.campaign ?? '–',
          registeredAt: ts(u.registered_at),
          country: u.country ?? '',
          product: u.status === 'free' ? null : u.plan,
          subStart: ts(u.sub_start),
          cancelAt: u.status === 'cancelled' ? ts(u.sub_end) : null,
          revenue: n(u.revenue),
          commission: n(u.commission),
          member: u.member_status === 'excluded' ? 'failed' : u.member_status,
          activeDays: null,
          couponPeriods: null,
        })),
        // Partnerin kendi kazancı (temsilci payı ayrı); bakiye ikisini birlikte gösterir (ödeme birlikte yapılır)
        commissions: ledger.filter((l) => !isRepRow(l)).map(toRow),
        allLedger: ledger.map(toRow),
        payouts: payouts.map((x) => {
          const from = Date.parse(`${x.period}T00:00:00`);
          const to = new Date(from);
          to.setMonth(to.getMonth() + 1);
          return { at: ts(x.paid_at) ?? ts(x.created_at), amount: n(x.net_try), periodFrom: from, periodTo: to.getTime() - DAY, status: x.status };
        }),
        myRep: myRep ? { name: myRep.name || '–', telegram: '', email: myRep.email || '', since: ts(myRep.since) ?? joined, rated: myRep.rated_this_month } : null,
        flags: [],
        reps: [],
        partner: p,
        profile: {
          partnerId: p.partner_no,
          username: prof?.username ?? '',
          fullName: priv?.full_name ?? '',
          email: session.user.email ?? '',
          country: priv?.country ?? '',
          entity: priv?.entity_type ?? 'person',
          language: 'Türkçe',
          iban: acct ? `•••• ${acct.iban_son4}` : '',
          holder: acct?.holder ?? '',
          bankName: acct?.bank_name ?? '',
          bankCountry: acct?.bank_country ?? '',
          swift: acct?.swift_bic ?? '',
          ibanSince: ts(acct?.created_at) ?? now,
          contractAt: ts(p.contract_accepted_at) ?? joined,
          contractVersion: p.contract_version ?? '1.0',
          domestic: p.domestic,
          status: PARTNER_STATUS[p.status] ?? p.status,
        },
      };

      if (p.is_rep) {
        const [list, flags, checks] = await Promise.all([rpc('rep_my_partners'), rpc('rep_my_flags'), rpc('rep_my_channel_checks')]);
        const checkOf = Object.fromEntries(checks.map((c) => [c.partner_no, { betting: c.betting_ads, note: c.note }]));
        const repRows = ledger.filter(isRepRow);
        const month0 = new Date(now);
        month0.setDate(1);
        month0.setHours(0, 0, 0, 0);
        const shares = [3, 2, 1, 0].map((k) => {
          const a = new Date(month0);
          a.setMonth(a.getMonth() - k);
          const b = new Date(a);
          b.setMonth(b.getMonth() + 1);
          return repRows.filter((l) => ts(l.created_at) >= a.getTime() && ts(l.created_at) < b.getTime() && l.status !== 'cancelled').reduce((s, l) => s + n(l.amount_try), 0);
        });
        data.rep = {
          inviteCode: p.invite_code,
          rate: n(p.rep_rate),
          shares,
          partners: list.map((x) => ({
            name: x.name || x.partner_no,
            channel: x.channel || '–',
            status: PARTNER_STATUS[x.status] ?? 'review',
            linkedBy: x.linked_by || 'auto',
            users: n(x.users),
            activeSubs: n(x.active_subs),
            monthRevenue: n(x.month_revenue),
            monthShare: n(x.month_share),
            lastSignupAt: ts(x.last_signup),
            no: x.partner_no,
            check: checkOf[x.partner_no] ?? null,
          })),
        };
        data.rep.activeSubs = data.rep.partners.reduce((s, x) => s + x.activeSubs, 0);
        data.rep.avg3 = data.rep.activeSubs;
        data.flags = flags.map((f) => ({
          id: f.id,
          partner: f.partner_name || f.partner_no,
          kind: f.kind,
          at: ts(f.created_at),
          members: n(f.details?.members),
          subRate: n(f.details?.sub_rate),
          sameDevice: n(f.details?.same_device),
          pattern: n(f.details?.pattern),
          held: n(f.details?.held),
          overdue: !f.rep_decision && now - ts(f.created_at) > 7 * DAY,
          decision: f.rep_decision,
          note: f.rep_note,
        }));
      }
      return data;
    },

    // ---- Yönetici (RLS: partner_admins + aal2) ----
    async loadAdmin() {
      const [partners, priv, accts, payouts, settings, feedback, ledger, log, errs, checks] = await Promise.all([
        sb.from('partners').select('*').order('created_at', { ascending: false }).then(ok),
        sb.from('partner_private').select('partner_id,full_name,id_no_ozet,phone_ozet,country,entity_type,company_name,tax_office,company_reg_no,channel_links,followers,id_doc_path,id_doc_back_path,updated_at').then(ok),
        sb.from('partner_payout_accounts').select('id,partner_id,iban_ozet,iban_son4,holder,bank_name,bank_country,swift_bic,bank_code,active,created_at').eq('active', true).then(ok),
        sb.from('partner_payouts').select('id,partner_id,period,amount_try,withholding_try,net_try,iban_son4,holder,status,created_at,approved_at,paid_at').order('created_at', { ascending: false }).then(ok),
        sb.from('partner_settings').select('*').then(ok),
        sb.from('partner_rep_feedback').select('*').then(ok),
        sb.from('partner_ledger').select('partner_id,amount_try,status').in('status', ['pending', 'available', 'frozen', 'in_payout']).limit(50000).then(ok),
        sb.from('partner_admin_log').select('*').in('entity', ['partners', 'mfa_reset']).order('at', { ascending: false }).limit(500).then(ok),
        sb.from('partner_event_errors').select('id', { count: 'exact', head: true }).gte('created_at', new Date(Date.now() - 7 * DAY).toISOString()),
        sb.from('partner_channel_checks').select('*').order('month', { ascending: false }).limit(5000).then(ok),
      ]);
      const byId = Object.fromEntries(priv.map((x) => [x.partner_id, x]));
      const acct = Object.fromEntries(accts.map((x) => [x.partner_id, x]));
      const bal = {};
      for (const l of ledger) {
        const b = (bal[l.partner_id] ??= { available: 0, pending: 0 });
        if (l.status === 'available') b.available += n(l.amount_try);
        else if (l.status !== 'in_payout') b.pending += n(l.amount_try);
      }
      const list = partners.map((p) => ({ ...p, priv: byId[p.id] ?? {}, account: acct[p.id] ?? null, balance: bal[p.id] ?? { available: 0, pending: 0 } }));
      const name = Object.fromEntries(list.map((p) => [p.id, p.priv.full_name || p.partner_no]));
      return {
        partners: list,
        name,
        payouts: payouts.map((x) => ({ ...x, name: name[x.partner_id] ?? '–' })),
        settings: Object.fromEntries(settings.map((x) => [x.key, x.value])),
        feedback,
        log,
        errors: errs.count ?? 0,
        checks,
      };
    },
    async resetMfa(partnerId) {
      const { data, error } = await sb.functions.invoke('partner-yonetim', { body: { action: 'reset_mfa', partner_id: partnerId } });
      if (error) {
        const detail = await error.context?.json?.().catch(() => null);
        throw new Error(detail?.error ?? error.message);
      }
      return data;
    },
    // Şifreli kişisel veri: sadece yönetici, her istek sunucuda kayda geçer
    reveal: (id) => rpc('admin_partner_reveal', { p_partner: id }),
    exportPayouts: (kind) => rpc('admin_payout_export', { p_tur: kind }),
    docUrl: async (path) => ok(await sb.storage.from('partner-belgeler').createSignedUrl(path, 300)).signedUrl,
    decideApplication: (id, approve, rate, note) => rpc('admin_partner_decide', { p_partner: id, p_approve: approve, p_rate: rate, p_note: note }),
    updatePartner: (id, patch) => rpc('admin_partner_update', { p_partner: id, p: patch }),
    setPayout: (id, status) => rpc('admin_payout_set', { p_id: id, p_status: status }),
    setSetting: (key, value) => rpc('admin_setting_set', { p_key: key, p_value: value }),
    acceptContract: (version) => rpc('partner_accept_contract', { p_version: version }),
  };
  return live;
}
