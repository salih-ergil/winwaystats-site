/**
 * DAVRANIŞSAL FARKINDALIK HESAPLARI (Salih, 2026-10-02). Saf fonksiyonlar, testli (__tests__/behaviorInsights.test.ts).
 * Uygulamada kullanıcının kendi kupon ve coin geçmişinden, 12 saatlik anlık görüntüyle (00:00 / 12:00 TR) hesaplanır
 * (useBehaviorInsights). Mevcut behavior.ts / habits.ts fonksiyonlarına dokunulmaz (Gelişim Raporu, diğer profiller ve demo onları kullanır).
 *
 * Tanımlar:
 *  - Sadece sonuçlanmış kuponlar. İade kuponlar seri ve oran hesaplarına girmez.
 *  - Bakiye oranı = yatırılan coin / kupon oynandığı andaki bakiye (coin defterinden: kupon kaydındaki bakiye + yatırılan;
 *    o an açık olan kuponların tutarı da bakiyeye sayılır, yoksa art arda oynanan kuponlarda oran şişer — 2026-10-07).
 *  - Referans değer = son 28 gündeki ilgili göstergenin medyanı.
 *  - Anlamlı değişim = referansa göre ±%25 ya da daha fazla (SIGNIFICANT_CHANGE).
 *  - Seriler sonuçlanma sırasıyla, son 7 sonuçlanmış kupon penceresinde. Seriyi tamamlayan kupon sonuçlandıktan SONRA
 *    oynanan ilk 3 kuponda bakiye oranı, sonuçtan sonraki ilk kupona kadar süre ve sonuçtan sonraki 24 saatteki kupon
 *    sayısı referansla karşılaştırılır (kullanıcı sonucu görmeden oynadığı kupon seriye tepki sayılmaz — 2026-10-07).
 */
// ——— Ayarlanabilir sabitler ———
export const SIGNIFICANT_CHANGE = 0.25;
export const REFERENCE_DAYS = 28;
export const PATTERN_WINDOW = 7;
export const LOSS_STREAK_MIN = 4;
export const WIN_STREAK_MIN = 3;
export const RETURN_MIN_LOSSES = 4;
export const FOLLOW_UP_COUPONS = 3;
export const BASELINE_DAYS = 14;
/** Başlangıç profili için ilk 14 günde en az bu kadar sonuçlanmış kupon (varsayım; Salih değiştirebilir) */
export const BASELINE_MIN_COUPONS = 5;
/** Bir gün / saat dilimi hakkında yorum için son 4 haftada o dilimde en az bu kadar kupon */
export const MIN_SLOT_COUPONS = 5;
export const SLOT_WEEKS = 4;
/** Saat dilimleri: 3 saatlik 8 dilim */
export const HOUR_SLOT_SIZE = 3;
const HOUR = 3600000;
const DAY = 24 * HOUR;
/** Türkiye saati (yaz saati uygulaması yok) */
const TR = 3 * HOUR;
// ——— Yardımcılar ———
export function median(xs) {
    if (!xs.length)
        return null;
    const s = [...xs].sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
/** Referansa göre değişim oranı (0.3 = %30 fazla); referans yoksa ya da 0 ise null */
export const changeRatio = (value, reference) => value === null || reference === null || reference === 0 ? null : (value - reference) / reference;
/** Ondalık yuvarlama payı (tam %25 değişim de anlamlı sayılsın) */
const EPS = 1e-9;
export const isSignificant = (value, reference) => {
    const c = changeRatio(value, reference);
    return c !== null && Math.abs(c) >= SIGNIFICANT_CHANGE - EPS;
};
/** Türkiye saatine göre haftanın günü: 0 = Pazartesi … 6 = Pazar */
export const trWeekday = (ms) => (new Date(ms + TR).getUTCDay() + 6) % 7;
/** Türkiye saatine göre saat dilimi: 0 = 00–03 … 7 = 21–24 */
export const trHourSlot = (ms) => Math.floor(new Date(ms + TR).getUTCHours() / HOUR_SLOT_SIZE);
/** Türkiye gününün başlangıcı */
const trDay = (ms) => Math.floor((ms + TR) / DAY) * DAY - TR;
/** Bir anda bakiye (coin defterinden) */
function balanceAt(ledger, at) {
    let b = 0;
    for (const e of ledger) {
        if (Date.parse(e.at) > at)
            break;
        b = e.balanceAfter;
    }
    return b;
}
/** Kuponun sonuçlanma anı (bekleyen kupon için null) */
export function settledAtOf(c, payoutAt) {
    if (c.status === 'pending')
        return null;
    const s = c.settledAt ? Date.parse(c.settledAt) : NaN;
    return Number.isFinite(s) ? s : payoutAt.get(c.id) ?? Date.parse(c.createdAt);
}
/** Kazanç / iade hareketlerinin zamanı (sonuçlanma anı kaydı olmayan eski kuponlar için) */
function payoutTimes(ledger) {
    const m = new Map();
    for (const e of ledger)
        if ((e.type === 'payout' || e.type === 'refund') && e.couponId && !m.has(e.couponId))
            m.set(e.couponId, Date.parse(e.at));
    return m;
}
/**
 * at anında açık olan (oynanmış, sonuçlanmamış) kuponların tutar toplamı; kendisi hariç. Sadece son ay başı bütçesinden
 * (since) sonra oynananlar: önceki ayın açık kuponu yeni ayın bakiyesinden düşülmemiştir.
 */
function openStakeAt(spans, at, since, except) {
    let sum = 0;
    for (const x of spans)
        if (x.id !== except && x.from >= since && x.from < at && x.to > at)
            sum += x.stake;
    return sum;
}
/** at anından önceki (dahil) son aylık bütçe kaydının zamanı */
function grantBefore(ledger, at) {
    let g = -Infinity;
    for (const e of ledger)
        if (e.type === 'monthly_grant' && Date.parse(e.at) <= at)
            g = Math.max(g, Date.parse(e.at));
    return g;
}
function couponSpans(history) {
    const payoutAt = payoutTimes(history.ledger);
    return history.coupons.map((c) => ({
        id: c.id,
        from: Date.parse(c.createdAt),
        to: settledAtOf(c, payoutAt) ?? Infinity,
        stake: c.stake,
    }));
}
/** Sonuçlanmış kuponlar, eskiden yeniye; lig bilgisi maç kimliğinden (leagueOf) */
export function couponFacts(history, leagueOf = () => undefined) {
    const stakeBalance = new Map();
    for (const e of history.ledger)
        if (e.type === 'stake' && e.couponId)
            stakeBalance.set(e.couponId, e.balanceAfter + Math.abs(e.amount));
    const ledger = [...history.ledger].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
    const payoutAt = payoutTimes(history.ledger);
    const spans = couponSpans(history);
    return history.coupons
        .filter((c) => c.status !== 'pending')
        .map((c) => {
        const at = Date.parse(c.createdAt);
        const balanceBefore = (stakeBalance.get(c.id) ?? balanceAt(ledger, at - 1)) + openStakeAt(spans, at, grantBefore(ledger, at), c.id);
        return {
            id: c.id,
            at,
            settledAt: settledAtOf(c, payoutAt) ?? at,
            stake: c.stake,
            balanceBefore,
            ratio: balanceBefore > 0 ? Math.min(1, c.stake / balanceBefore) : 1,
            status: c.status,
            matches: c.selections.length,
            totalOdds: c.totalOdds,
            net: Math.round((c.payout - c.stake) * 100) / 100,
            leagues: [...new Set(c.selections.map((s) => leagueOf(s.matchId)).filter((x) => !!x))],
        };
    })
        .sort((a, b) => a.at - b.at);
}
/**
 * [until − 28 gün, until) aralığındaki kuponlardan medyanlar.
 * gapHours: bir kuponun sonuçlanmasından sonra oynanan ilk kupona kadar geçen süre (seri sonrası süreyle aynı ölçü).
 * perDay: kupon oynanan günlerdeki günlük kupon sayısının medyanı.
 */
export function reference(facts, until) {
    const list = facts.filter((f) => f.status !== 'void' && f.at < until && f.at >= until - REFERENCE_DAYS * DAY);
    const gaps = [];
    for (const f of list) {
        if (f.settledAt >= until)
            continue;
        const next = list.find((x) => x.at > f.settledAt);
        if (next)
            gaps.push((next.at - f.settledAt) / HOUR);
    }
    const perDay = new Map();
    list.forEach((f) => perDay.set(trDay(f.at), (perDay.get(trDay(f.at)) ?? 0) + 1));
    return { ratio: median(list.map((f) => f.ratio)), gapHours: median(gaps), perDay: median([...perDay.values()]) };
}
/**
 * Seri tespiti (iade hariç sonuçlanmış kuponlar, sonuçlanma sırasıyla). Bir seri, koşul ilk sağlandığı kuponda kaydedilir;
 * zamanı o kuponun sonuçlandığı an. Sonraki kuponlar: bu andan sonra oynanan ilk 3 kupon.
 * Önceki serinin "sonraki 3 kupon"u dolmadan yeni seri sayılmaz (iç içe geçmesin diye; varsayım).
 * Aynı kuponda hem kazanç serisi hem dönüş algısı varsa dönüş algısı kaydedilir.
 */
export function detectPatterns(facts) {
    const decided = facts.filter((f) => f.status !== 'void');
    const list = [...decided].sort((a, b) => a.settledAt - b.settledAt || a.at - b.at);
    const byPlacement = [...decided].sort((a, b) => a.at - b.at);
    const events = [];
    /** Önceki serinin 3. takip kuponunun oynandığı an; bu andan önce sonuçlanan kupon yeni seri başlatmaz */
    let blockedUntil = -Infinity;
    /** Önceki serinin takip kuponları da yeni seri başlatmaz */
    let blockedIds = new Set();
    let lossRun = 0;
    let winRun = 0;
    for (let i = 0; i < list.length; i++) {
        const f = list[i];
        lossRun = f.status === 'lost' ? lossRun + 1 : 0;
        winRun = f.status === 'won' ? winRun + 1 : 0;
        if (f.settledAt <= blockedUntil || blockedIds.has(f.id))
            continue;
        const window = list.slice(Math.max(0, i - PATTERN_WINDOW + 1), i + 1);
        const losses = window.filter((x) => x.status === 'lost').length;
        let kind = null;
        let count = 0;
        if (f.status === 'won' && winRun <= 2 && window.length >= PATTERN_WINDOW && losses >= RETURN_MIN_LOSSES) {
            kind = 'returnPerception';
            count = winRun;
        }
        else if (lossRun === LOSS_STREAK_MIN) {
            kind = 'lossStreak';
            count = lossRun;
        }
        else if (winRun === WIN_STREAK_MIN) {
            kind = 'winStreak';
            count = winRun;
        }
        if (!kind)
            continue;
        const at = f.settledAt;
        const next = byPlacement.filter((x) => x.at > at).slice(0, FOLLOW_UP_COUPONS);
        const day = byPlacement.filter((x) => x.at > at && x.at <= at + DAY).length;
        events.push({
            kind,
            couponId: f.id,
            at,
            count,
            windowNet: Math.round(window.reduce((s, x) => s + x.net, 0) * 100) / 100,
            after: {
                coupons: next.length,
                complete: next.length >= FOLLOW_UP_COUPONS,
                ratio: median(next.map((x) => x.ratio)),
                // Sonucu gördükten sonra ilk kupona kadar geçen süre
                gapHours: next.length ? (next[0].at - at) / HOUR : null,
                perDay: next.length ? day : null,
                couponIds: next.map((x) => x.id),
            },
            reference: reference(facts, at),
        });
        blockedUntil = next.length >= FOLLOW_UP_COUPONS ? next[next.length - 1].at : Infinity;
        blockedIds = new Set(next.map((x) => x.id));
    }
    return events;
}
function weekStats(facts, from, to) {
    const list = facts.filter((f) => f.at >= from && f.at < to);
    return { coupons: list.length, avgRatio: mean(list.filter((f) => f.status !== 'void').map((f) => f.ratio)) };
}
export function weekly(facts, patterns, now) {
    return {
        current: weekStats(facts, now - 7 * DAY, now + 1),
        previous: weekStats(facts, now - 14 * DAY, now - 7 * DAY),
        patterns: patterns.filter((p) => p.at >= now - 7 * DAY && p.at <= now),
    };
}
function metricsOf(facts, all, days) {
    const decided = facts.filter((f) => f.status !== 'void');
    // Kayıptan sonra bir sonraki kupona kadar geçen süre (saat): kaybeden kuponun ardından oynanan ilk kupon (tüm geçmişten)
    const gaps = [];
    for (const f of decided.filter((x) => x.status === 'lost')) {
        const next = all.find((x) => x.at > f.at);
        if (next)
            gaps.push((next.at - f.at) / HOUR);
    }
    return {
        avgRatio: mean(decided.map((f) => f.ratio)),
        weeklyCoupons: facts.length ? (facts.length / days) * 7 : null,
        gapAfterLoss: mean(gaps),
        avgMatches: mean(facts.map((f) => f.matches)),
        avgOdds: mean(decided.map((f) => f.totalOdds)),
    };
}
/** İlk 14 gün (ilk kuponun günü dahil) başlangıç profili; son 7 gün bununla karşılaştırılır */
export function baseline(facts, now) {
    if (!facts.length)
        return { status: 'not_enough', coupons: 0 };
    const from = trDay(facts[0].at);
    const until = from + BASELINE_DAYS * DAY;
    if (now < until)
        return { status: 'forming', until };
    const first = facts.filter((f) => f.at < until);
    if (first.length < BASELINE_MIN_COUPONS)
        return { status: 'not_enough', coupons: first.length };
    const recent = facts.filter((f) => f.at >= now - 7 * DAY && f.at <= now);
    return { status: 'ready', from, until, coupons: first.length, metrics: metricsOf(first, facts, BASELINE_DAYS), current: metricsOf(recent, facts, 7) };
}
export function slots(facts, patterns, now) {
    const from = now - SLOT_WEEKS * 7 * DAY;
    const list = facts.filter((f) => f.status !== 'void' && f.at >= from && f.at <= now);
    const overallRatio = median(list.map((f) => f.ratio));
    const after = new Set(patterns.flatMap((p) => p.after.couponIds));
    const build = (n, key) => Array.from({ length: n }, (_, slot) => {
        const inSlot = list.filter((f) => key(f.at) === slot);
        const avgRatio = median(inSlot.map((f) => f.ratio));
        const enough = inSlot.length >= MIN_SLOT_COUPONS;
        const c = changeRatio(avgRatio, overallRatio);
        return {
            slot,
            coupons: inSlot.length,
            avgRatio,
            perWeek: inSlot.length / SLOT_WEEKS,
            afterPattern: inSlot.filter((f) => after.has(f.id)).length,
            enough,
            changed: enough && c !== null && Math.abs(c) >= SIGNIFICANT_CHANGE - EPS ? (c > 0 ? 'higher' : 'lower') : null,
        };
    });
    return { days: build(7, trWeekday), hours: build(24 / HOUR_SLOT_SIZE, trHourSlot), overallRatio };
}
export function orgCalendar(facts, now) {
    const from = now - SLOT_WEEKS * 7 * DAY;
    const days = Array.from({ length: 7 }, (_, weekday) => ({ weekday, leagues: [] }));
    for (const f of facts) {
        if (f.at < from || f.at > now)
            continue;
        const day = days[trWeekday(f.at)];
        for (const id of f.leagues) {
            const x = day.leagues.find((l) => l.leagueId === id);
            if (x)
                x.coupons++;
            else
                day.leagues.push({ leagueId: id, coupons: 1 });
        }
    }
    days.forEach((d) => d.leagues.sort((a, b) => b.coupons - a.coupons));
    return days;
}
/**
 * Başlangıç bakiyesi: bu ayın tanımlanan bütçesi (ayın 1'i ya da üyelik). Güncel bakiye: coin defterinin son kaydı.
 * Seri: ay başından bugüne her coin hareketinden sonraki bakiye.
 * Grafik: açık kuponlar etkilemez (Salih, 2026-10-07): kuponun tutarı sonuçlanana kadar bakiyeye sayılır; grafik
 * sadece sonuçlanmış kuponların etkisini gösterir. Gösterge ve güncel bakiye coin defterindeki gerçek bakiyedir.
 */
export function balanceView(ledger, now, coupons = []) {
    const spans = couponSpans({ coupons, ledger });
    const open = (at) => openStakeAt(spans, at + 1, grantBefore(ledger, at));
    const sorted = [...ledger].filter((e) => Date.parse(e.at) <= now).sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
    const grants = sorted.filter((e) => e.type === 'monthly_grant');
    const grant = grants[grants.length - 1];
    const startAt = grant ? Date.parse(grant.at) : null;
    const series = sorted.filter((e) => startAt === null || Date.parse(e.at) >= startAt).map((e) => ({ at: Date.parse(e.at), balance: e.balanceAfter }));
    const start = grant?.balanceAfter ?? 0;
    const weekAgo = [...series].reverse().find((p) => p.at <= now - 7 * DAY)?.balance ?? start;
    const current = sorted[sorted.length - 1]?.balanceAfter ?? 0;
    const from = now - 30 * DAY;
    const before = sorted.filter((e) => Date.parse(e.at) < from).pop();
    // Kupon oynanınca grafik değişmez (tutar sonuçlanana kadar bakiyeye sayılır); sonuçlanınca fark görünür.
    // Noktalar: coin hareketleri (kupon tutarı ve ay başı sıfırlama kaydı hariç) ve kayıp kuponların sonuçlanma anları.
    const effective = (t) => balanceAt(sorted, t) + open(t);
    const times = new Set();
    for (const e of sorted) {
        const t = Date.parse(e.at);
        if (t >= from && e.type !== 'monthly_reset' && e.type !== 'stake')
            times.add(t);
    }
    for (const x of spans)
        if (Number.isFinite(x.to) && x.to >= from && x.to <= now)
            times.add(x.to);
    const chart = [...(before ? [from] : []), ...[...times].sort((x, y) => x - y)].map((t) => ({ at: t, balance: effective(t) }));
    if (chart.length)
        chart.push({ at: now, balance: effective(now) });
    return { start, current, weekAgo, startAt, series, chart };
}
export function myStats(history, now) {
    const c = history.coupons;
    const settled = c.filter((x) => x.status !== 'pending');
    const decided = settled.filter((x) => x.status !== 'void');
    const won = c.filter((x) => x.status === 'won').length;
    const staked = settled.reduce((s, x) => s + x.stake, 0);
    const returned = settled.reduce((s, x) => s + x.payout, 0);
    const b = balanceView(history.ledger, now, history.coupons);
    return {
        played: c.length,
        won,
        lost: c.filter((x) => x.status === 'lost').length,
        void: c.filter((x) => x.status === 'void').length,
        winRate: decided.length ? Math.round((won / decided.length) * 100) : null,
        avgOdds: decided.length ? Math.round((decided.reduce((s, x) => s + x.totalOdds, 0) / decided.length) * 100) / 100 : null,
        roi: staked ? Math.round(((returned - staked) / staked) * 1000) / 10 : null,
        net: Math.round((b.current - b.start) * 100) / 100,
    };
}
export function computeInsights(history, leagueOf, nowDate) {
    const now = nowDate.getTime();
    const facts = couponFacts(history, leagueOf).filter((f) => f.at <= now);
    const patterns = detectPatterns(facts);
    return {
        version: 1,
        computedAt: nowDate.toISOString(),
        balance: balanceView(history.ledger, now, history.coupons),
        weekly: weekly(facts, patterns, now),
        baseline: baseline(facts, now),
        slots: slots(facts, patterns, now),
        calendar: orgCalendar(facts, now),
        // Ekranda son 4 haftanın serileri
        patterns: patterns.filter((p) => p.at >= now - SLOT_WEEKS * 7 * DAY),
        stats: myStats(history, now),
    };
}
