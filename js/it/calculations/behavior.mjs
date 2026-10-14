/**
 * DAVRANIŞ FARKINDALIĞI GÖSTERGELERİ (Salih onayladı, 2026-09-30).
 * Kaynak: sunum PDF'i s.2'deki telefon görseli. Tanımlar CLAUDE.md'de.
 * Bunlar basit ve açıklanabilir hesaplardır; KKS/KYS gibi Salih'in formüllerini beklemez.
 * Tüm fonksiyonlar saf (yan etkisiz): aynı geçmiş + aynı "şimdi" → aynı sonuç.
 */
export const MONTHLY_BUDGET = 50000;
const HOUR = 3600000;
const DAY = 24 * HOUR;
/** Kayıptan sonra bu süre içinde daha yüksek tutarla oynanan kupon "telafi amaçlı" sayılır */
export const COMPENSATION_WINDOW_MS = 24 * HOUR;
const TR_OFFSET = 3 * HOUR;
/** Türkiye saatine göre gün: "2026-09-30" */
const trDay = (ms) => new Date(ms + TR_OFFSET).toISOString().slice(0, 10);
const time = (iso) => new Date(iso).getTime();
const isCoinFlow = (e) => e.type === 'stake' || e.type === 'payout' || e.type === 'refund' || e.type === 'correction';
/** Belirli bir andaki bakiye (o ana kadarki son işlem defteri kaydı) */
export function balanceAt(ledger, at) {
    let balance = 0;
    for (const e of ledger) {
        if (time(e.at) > at)
            break;
        balance = e.balanceAfter;
    }
    return balance;
}
/**
 * Performans grafiği: son `days` günün her gününün sonundaki bakiye ve
 * o güne kadarki en fazla 30 günün ortalaması (kesik çizgi).
 */
export function balanceSeries(ledger, now, days = 30) {
    const end = now.getTime();
    const points = [];
    for (let i = days - 1; i >= 0; i--) {
        const at = i === 0 ? end : end - i * DAY;
        points.push({ at, balance: balanceAt(ledger, at), average: 0 });
    }
    points.forEach((p, i) => {
        const window = points.slice(Math.max(0, i - 29), i + 1);
        p.average = Math.round(window.reduce((s, w) => s + w.balance, 0) / window.length);
    });
    return points;
}
/**
 * Haftalık değişim: bakiyenin 7 gün önceye göre değişimi.
 * Bu hafta aylık bütçe yenilendiyse karşılaştırma yenilemeden sonraki bakiyeyle yapılır
 * (yenilemenin kendisi "kazanç" sayılmaz).
 */
export function weeklyChange(ledger, now) {
    const end = now.getTime();
    let from = end - 7 * DAY;
    const lastGrant = [...ledger].reverse().find((e) => e.type === 'monthly_grant' && time(e.at) > from && time(e.at) <= end);
    if (lastGrant)
        from = time(lastGrant.at);
    const coins = ledger
        .filter((e) => isCoinFlow(e) && time(e.at) > from && time(e.at) <= end)
        .reduce((s, e) => s + e.amount, 0);
    const base = lastGrant ? lastGrant.balanceAfter : balanceAt(ledger, from);
    return { coins: Math.round(coins), percent: base > 0 ? round1((coins / base) * 100) : null };
}
/** Son `days` günde sonuçlanan kuponlar */
function settledWithin(coupons, now, days) {
    const end = now.getTime();
    return coupons.filter((c) => c.settledAt && c.status !== 'pending' && time(c.settledAt) > end - days * DAY && time(c.settledAt) <= end);
}
/** 30 günlük performans (ROI): (kazanılan − yatırılan) / yatırılan. Kupon yoksa null. */
export function roi(coupons, now, days = 30) {
    const settled = settledWithin(coupons, now, days).filter((c) => c.status !== 'void');
    const staked = settled.reduce((s, c) => s + c.stake, 0);
    if (staked === 0)
        return null;
    const returned = settled.reduce((s, c) => s + c.payout, 0);
    return round1(((returned - staked) / staked) * 100);
}
/**
 * BÜTÇE DENGESİ (Salih'in seçimi, 2026-09-30; "Doğru Karar Oranı"nın yerine).
 * Ayın her geçen günü için "ayın ne kadarı geçti" ile "bütçenin ne kadarı elde" karşılaştırılır.
 * Örnek: ayın üçte biri geçtiyse bütçenin üçte ikisinin elde olması dengeli sayılır (başvuru çizgisi).
 * Bakiye bu çizginin altına düştüğü günlerde fark (yüzde puanı) hesaplanır; üstündeyse fark 0'dır.
 * Gösterge = 100 − ortalama fark (0–100). Günler gün sonundaki bakiyeyle, bugün şu anki bakiyeyle ölçülür.
 * `monthsAgo`: 0 bu ay, 1 geçen ay. Hesaplanacak bakiye kaydı yoksa null.
 */
export function budgetBalance(ledger, now, monthsAgo = 0) {
    const d = new Date(now.getTime() + TR_OFFSET);
    const from = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - monthsAgo, 1) - TR_OFFSET;
    const to = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - monthsAgo + 1, 1) - TR_OFFSET;
    const end = Math.min(now.getTime(), to - 1);
    const sorted = [...ledger].sort((a, b) => time(a.at) - time(b.at));
    const first = sorted.find((e) => e.type === 'monthly_grant' && time(e.at) < to);
    if (!first || time(first.at) > end)
        return null;
    // Başlangıç: ayın 1'i ya da (ay içinde üye olduysa) ilk bütçenin tanımlandığı an
    const start = Math.max(from, time(first.at));
    const samples = [];
    for (let t = from + DAY - 1; t < end; t += DAY)
        if (t >= start)
            samples.push(t);
    samples.push(end);
    const diffs = samples.map((t) => {
        const reference = 1 - (t - from) / (to - from);
        const share = balanceAt(sorted, t) / MONTHLY_BUDGET;
        return Math.max(0, reference - share) * 100;
    });
    return Math.round(100 - diffs.reduce((a, b) => a + b, 0) / diffs.length);
}
/**
 * Telafi amaçlı karar: kaybeden bir kuponun sonucu belli olduktan sonraki 24 saat içinde,
 * o kupondan DAHA YÜKSEK tutarla oynanan kupon.
 */
export function isCompensation(coupon, all) {
    return compensationIds(all).has(coupon.id);
}
/** Uzun geçmişlerde (15 ay, ~1.500 kupon) hızlı olsun diye: kupon listesi başına bir kez hesaplanır */
const compensationCache = new WeakMap();
/** Telafi amaçlı kuponların kimlikleri (isCompensation ile aynı kural) */
export function compensationIds(all) {
    const hit = compensationCache.get(all);
    if (hit)
        return hit;
    // Kaybeden kuponlar sonuçlandığı ana göre sıralı; her kupon için önceki 24 saate ikili aramayla bakılır
    const lost = all
        .filter((c) => c.status === 'lost' && c.settledAt !== undefined)
        .map((c) => ({ id: c.id, at: time(c.settledAt), stake: c.stake }))
        .sort((a, b) => a.at - b.at);
    const firstAtOrAfter = (t) => {
        let lo = 0;
        let hi = lost.length;
        while (lo < hi) {
            const mid = (lo + hi) >> 1;
            if (lost[mid].at < t)
                lo = mid + 1;
            else
                hi = mid;
        }
        return lo;
    };
    const ids = new Set();
    for (const c of all) {
        const created = time(c.createdAt);
        for (let i = firstAtOrAfter(created - COMPENSATION_WINDOW_MS); i < lost.length && lost[i].at <= created; i++) {
            if (lost[i].id !== c.id && c.stake > lost[i].stake) {
                ids.add(c.id);
                break;
            }
        }
    }
    compensationCache.set(all, ids);
    return ids;
}
/** Kayıptan sonraki tutar artışının sonucunun değerlendirildiği süre */
export const ASSESSMENT_WINDOW_MS = 12 * HOUR;
/**
 * KAYIPTAN SONRA TUTAR ARTIŞININ DEĞERLENDİRİLMESİ (Salih'in kuralı, 2026-09-30).
 * Tutarı artırmak tek başına sorun sayılmaz (bazı stratejilerde bilinçli yapılır). Ölçüt sonuçtur:
 * kayıptan sonra tutarı artırılan kupondan başlayarak sonraki 12 saatte oynanan bütün kuponların net sonucu
 * eksiyse (zarar büyüdüyse) bu karar "zararı büyüten artış" sayılır.
 */
export function assessIncreases(coupons, now) {
    const end = now.getTime();
    const ids = compensationIds(coupons);
    // Oynanma anına göre sıralı liste: 12 saatlik pencere ikili aramayla bulunur
    const byCreated = [...coupons].sort((a, b) => time(a.createdAt) - time(b.createdAt));
    const startIndex = (t) => {
        let lo = 0;
        let hi = byCreated.length;
        while (lo < hi) {
            const mid = (lo + hi) >> 1;
            if (time(byCreated[mid].createdAt) < t)
                lo = mid + 1;
            else
                hi = mid;
        }
        return lo;
    };
    return coupons
        .filter((c) => time(c.createdAt) <= end && ids.has(c.id))
        .map((c) => {
        const start = time(c.createdAt);
        const windowEnd = start + ASSESSMENT_WINDOW_MS;
        const inWindow = [];
        for (let i = startIndex(start); i < byCreated.length && time(byCreated[i].createdAt) <= windowEnd; i++)
            inWindow.push(byCreated[i]);
        // Değerlendirme için: 12 saat dolmuş ve o süredeki kuponların hepsi (şu ana göre) sonuçlanmış olmalı
        const settledByNow = (x) => x.status !== 'pending' && !!x.settledAt && time(x.settledAt) <= end;
        if (end < windowEnd || !inWindow.every(settledByNow))
            return { coupon: c, windowEnd, net: null, outcome: 'pending' };
        const net = Math.round(inWindow.reduce((s, x) => s + x.payout - x.stake, 0));
        return { coupon: c, windowEnd, net, outcome: net < 0 ? 'deepened' : 'not_deepened' };
    });
}
export function compensationTrend(coupons, now) {
    const end = now.getTime();
    const assessed = assessIncreases(coupons, now);
    const inRange = (from, to) => assessed.filter((a) => time(a.coupon.createdAt) > from && time(a.coupon.createdAt) <= to);
    const thisWeek = inRange(end - 7 * DAY, end);
    const lastWeek = inRange(end - 14 * DAY, end - 7 * DAY);
    const deepened = (list) => list.filter((a) => a.outcome === 'deepened').length;
    const deepenedThisWeek = deepened(thisWeek);
    const deepenedLastWeek = deepened(lastWeek);
    return {
        thisWeek: thisWeek.length,
        lastWeek: lastWeek.length,
        deepenedThisWeek,
        deepenedLastWeek,
        pendingThisWeek: thisWeek.filter((a) => a.outcome === 'pending').length,
        changePercent: deepenedLastWeek > 0 ? Math.round(((deepenedThisWeek - deepenedLastWeek) / deepenedLastWeek) * 100) : null,
    };
}
export function burnRate(ledger, now) {
    const end = now.getTime();
    const net = ledger.filter((e) => isCoinFlow(e) && time(e.at) > end - 7 * DAY && time(e.at) <= end).reduce((s, e) => s + e.amount, 0);
    const dailyNet = Math.round(net / 7);
    const balance = balanceAt(ledger, end);
    return {
        dailyNet,
        daysLeft: dailyNet < 0 ? Math.max(0, Math.round(balance / -dailyNet)) : null,
        remainingPercent: Math.round((balance / MONTHLY_BUDGET) * 100),
    };
}
export function frequency(coupons, now) {
    const end = now.getTime();
    const count = (from, to) => coupons.filter((c) => time(c.createdAt) > from && time(c.createdAt) <= to).length;
    return {
        lastDay: count(end - DAY, end),
        previousDay: count(end - 2 * DAY, end - DAY),
        week: count(end - 7 * DAY, end),
        previousWeek: count(end - 14 * DAY, end - 7 * DAY),
    };
}
/**
 * Zaman dilimleri: günler (son 30 gün), haftalar (son 12 hafta) ya da aylar (son `months` ay, varsayılan 6), eskiden yeniye.
 * Günler ve aylar Türkiye saatine göre takvim günü/ayı; haftalar bugünden geriye 7 günlük dilimler.
 */
export function timeBuckets(now, unit, months = 6) {
    const end = now.getTime();
    const buckets = [];
    if (unit === 'week') {
        for (let i = 11; i >= 0; i--)
            buckets.push({ key: `w${i}`, from: end - (i + 1) * 7 * DAY, to: end - i * 7 * DAY });
    }
    else if (unit === 'day') {
        const today = Date.parse(`${trDay(end)}T00:00:00Z`) - TR_OFFSET;
        for (let i = 29; i >= 0; i--)
            buckets.push({ key: trDay(today - i * DAY), from: today - i * DAY, to: today - (i - 1) * DAY });
    }
    else {
        const d = new Date(end + TR_OFFSET);
        for (let i = months - 1; i >= 0; i--) {
            const from = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - i, 1) - TR_OFFSET;
            const to = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - i + 1, 1) - TR_OFFSET;
            buckets.push({ key: new Date(from + TR_OFFSET).toISOString().slice(0, 7), from, to });
        }
    }
    return buckets;
}
/**
 * Kupon sıklığı grafiği: günlere (son 30 gün), haftalara (son 12 hafta) ya da aylara (son 6 ay) göre kupon sayısı.
 * Günler ve aylar Türkiye saatine göre takvim günü/ayı; haftalar bugünden geriye 7 günlük dilimler. Eskiden yeniye sıralı.
 */
export function couponCounts(coupons, now, unit) {
    const end = now.getTime();
    const buckets = timeBuckets(now, unit).map((b) => ({ ...b, count: 0 }));
    coupons.forEach((c) => {
        const t = time(c.createdAt);
        const b = buckets.find((x) => t >= x.from && t < x.to && t <= end);
        if (b)
            b.count++;
    });
    return buckets;
}
/** Karar Analizi 12 saatte bir güncellenir: Türkiye saatiyle 00:00 ve 12:00 */
export function decisionSnapshotTime(now) {
    const trMs = now.getTime() + TR_OFFSET;
    const half = 12 * HOUR;
    return new Date(Math.floor(trMs / half) * half - TR_OFFSET);
}
/** Karar Geçmişi ekranı için son `days` günün gün gün dökümü (en yeni gün başta) */
export function dailyBreakdown(history, now, days = 30) {
    const ledger = [...history.ledger].sort((a, b) => time(a.at) - time(b.at));
    const end = now.getTime();
    const deepenedIds = new Set(assessIncreases(history.coupons, now).filter((a) => a.outcome === 'deepened').map((a) => a.coupon.id));
    const result = [];
    for (let i = 0; i < days; i++) {
        const day = trDay(end - i * DAY);
        const dayStart = Date.parse(`${day}T00:00:00Z`) - TR_OFFSET;
        const dayEnd = Math.min(dayStart + DAY, end + 1);
        const inDay = (ms) => ms >= dayStart && ms < dayEnd;
        const coupons = history.coupons.filter((c) => inDay(time(c.createdAt))).sort((a, b) => time(b.createdAt) - time(a.createdAt));
        const entries = ledger.filter((e) => inDay(time(e.at)));
        result.push({
            day,
            coupons,
            staked: coupons.reduce((s, c) => s + c.stake, 0),
            net: Math.round(entries.filter(isCoinFlow).reduce((s, e) => s + e.amount, 0)),
            endBalance: balanceAt(ledger, dayEnd - 1),
            budgetRenewed: entries.some((e) => e.type === 'monthly_grant'),
            increasedAfterLoss: coupons.filter((c) => compensationIds(history.coupons).has(c.id)).length,
            deepened: coupons.filter((c) => deepenedIds.has(c.id)).length,
        });
    }
    return result;
}
/** Bütçe Kontrol ekranı: son `weeks` haftanın (7 günlük dilimler) bütçe kullanımı, en yeni başta */
export function weeklyBreakdown(history, now, weeks = 4) {
    const ledger = [...history.ledger].sort((a, b) => time(a.at) - time(b.at));
    const end = now.getTime();
    const deepenedIds = new Set(assessIncreases(history.coupons, now).filter((a) => a.outcome === 'deepened').map((a) => a.coupon.id));
    return Array.from({ length: weeks }, (_, index) => {
        const to = end - index * 7 * DAY;
        const from = to - 7 * DAY;
        const inRange = (ms) => ms > from && ms <= to;
        const coupons = history.coupons.filter((c) => inRange(time(c.createdAt)));
        const shares = coupons.map((c) => {
            // Kupon oynanmadan hemen önceki bakiye
            const before = balanceAt(ledger, time(c.createdAt) - 1);
            return before > 0 ? (c.stake / before) * 100 : 100;
        });
        return {
            index,
            from,
            to,
            startBalance: balanceAt(ledger, from),
            endBalance: balanceAt(ledger, to),
            net: Math.round(ledger.filter((e) => isCoinFlow(e) && inRange(time(e.at))).reduce((s, e) => s + e.amount, 0)),
            staked: coupons.reduce((s, c) => s + c.stake, 0),
            coupons: coupons.length,
            avgStakeShare: shares.length ? round1(shares.reduce((a, b) => a + b, 0) / shares.length) : null,
            maxStakeShare: shares.length ? round1(Math.max(...shares)) : null,
            increasedAfterLoss: coupons.filter((c) => compensationIds(history.coupons).has(c.id)).length,
            deepened: coupons.filter((c) => deepenedIds.has(c.id)).length,
            budgetRenewed: ledger.some((e) => e.type === 'monthly_grant' && inRange(time(e.at))),
        };
    });
}
/** İçinde bulunulan ayın bütçe kullanımı (son bütçe tanımından bu yana) */
export function monthUsage(history, now) {
    const ledger = [...history.ledger].sort((a, b) => time(a.at) - time(b.at));
    const end = now.getTime();
    const grant = [...ledger].reverse().find((e) => e.type === 'monthly_grant' && time(e.at) <= end);
    const since = grant ? time(grant.at) : 0;
    const after = ledger.filter((e) => time(e.at) >= since && time(e.at) <= end);
    const staked = -after.filter((e) => e.type === 'stake').reduce((s, e) => s + e.amount, 0);
    const returned = after.filter((e) => e.type === 'payout' || e.type === 'refund' || e.type === 'correction').reduce((s, e) => s + e.amount, 0);
    const balance = balanceAt(ledger, end);
    return { budget: MONTHLY_BUDGET, staked, returned: Math.round(returned), balance, remainingPercent: Math.round((balance / MONTHLY_BUDGET) * 100), since };
}
export function summarizeBehavior(history, now) {
    const ledger = [...history.ledger].sort((a, b) => time(a.at) - time(b.at));
    return {
        balance: balanceAt(ledger, now.getTime()),
        weekly: weeklyChange(ledger, now),
        roi30: roi(history.coupons, now),
        budgetBalance: budgetBalance(ledger, now),
        series: balanceSeries(ledger, now),
        compensation: compensationTrend(history.coupons, now),
        burn: burnRate(ledger, now),
        frequency: frequency(history.coupons, now),
    };
}
function round1(n) {
    return Math.round(n * 10) / 10;
}
