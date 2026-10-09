import { BASELINE_MIN_COUPONS, HOUR_SLOT_SIZE, isSignificant, MIN_SLOT_COUPONS, } from '/js/es/calculations/behaviorInsights.mjs';
import { fill, insightTexts as T } from '/js/es/content/insightTexts.mjs';
import { WEEKDAY_NAMES } from '/js/es/utils/date.mjs';
import { formatNumber, formatOdds, formatPercent } from '/js/es/utils/format.mjs';
import { t } from '/js/es/i18n.mjs';
/** Davranışsal farkındalık verisini kullanıcıya gösterilen cümlelere çevirir. Metinler: src/content/insightTexts.ts */
export const DAY_NAMES = WEEKDAY_NAMES;
const pad = (n) => String(n).padStart(2, '0');
export const hourSlotLabel = (slot) => `${pad(slot * HOUR_SLOT_SIZE)}:00–${pad((slot + 1) * HOUR_SLOT_SIZE)}:00`;
/** Bakiye oranı: %4,5 */
export const ratioText = (r) => (r === null ? '—' : formatPercent(r * 100, 1));
/** Süre: 45 dk · 6,5 saat · 3 gün */
export function durationText(hours) {
    if (hours === null)
        return '—';
    if (hours < 1)
        return t('duration.minutes', { n: Math.max(1, Math.round(hours * 60)) });
    if (hours < 48)
        return t('duration.hours', { n: formatNumber(hours, hours < 10 ? 1 : 0) });
    return t('duration.days', { n: formatNumber(hours / 24, 0) });
}
const countText = (n) => (n === null ? '—' : formatNumber(n, Number.isInteger(n) ? 0 : 1));
/** Seri başlığı: "Art arda 4 kuponunuz kaybetti." */
export function patternTitle(p) {
    if (p.kind === 'returnPerception') {
        return fill(T.pattern.returnPerception, {
            wins: p.count,
            net: formatNumber(Math.abs(p.windowNet), 0),
            direction: p.windowNet < 0 ? T.pattern.directionDown : T.pattern.directionUp,
        });
    }
    return fill(p.kind === 'lossStreak' ? T.pattern.lossStreak : T.pattern.winStreak, { count: p.count });
}
/** Seriden sonraki 3 kuponda referansa göre anlamlı değişen göstergeler */
export function patternFollowUp(p) {
    const event = T.pattern.eventNames[p.kind];
    if (!p.after.complete)
        return [fill(T.pattern.afterPending, { event })];
    const lines = [];
    const { after, reference: ref } = p;
    if (isSignificant(after.ratio, ref.ratio)) {
        lines.push(fill(after.ratio > ref.ratio ? T.pattern.afterRatioUp : T.pattern.afterRatioDown, {
            event, after: formatNumber(after.ratio * 100, 1), reference: formatNumber(ref.ratio * 100, 1),
        }));
    }
    if (isSignificant(after.gapHours, ref.gapHours)) {
        lines.push(fill(after.gapHours < ref.gapHours ? T.pattern.afterGapShorter : T.pattern.afterGapLonger, {
            event, after: durationText(after.gapHours), reference: durationText(ref.gapHours),
        }));
    }
    if (isSignificant(after.perDay, ref.perDay)) {
        lines.push(fill(after.perDay > ref.perDay ? T.pattern.afterFrequencyUp : T.pattern.afterFrequencyDown, {
            event, after: countText(after.perDay), reference: countText(ref.perDay),
        }));
    }
    return lines.length ? lines : [fill(T.pattern.afterSteady, { event })];
}
const METRIC_KEYS = ['avgRatio', 'weeklyCoupons', 'gapAfterLoss', 'avgMatches', 'avgOdds'];
const metricValue = (k, v) => v === null ? '—' : k === 'avgRatio' ? ratioText(v) : k === 'gapAfterLoss' ? durationText(v) : k === 'avgOdds' ? formatOdds(v) : countText(v);
/** "İlk haftalarınıza göre …" cümleleri (sadece başlangıç profili hazırsa); her gösterge ayrı */
export function baselineLines(b) {
    if (b.status !== 'ready')
        return [];
    return METRIC_KEYS.flatMap((key) => {
        const from = b.metrics[key];
        const to = b.current[key];
        if (from === null || to === null)
            return [];
        const metric = T.baseline.metrics[key];
        const changed = isSignificant(to, from);
        return [{
                key,
                changed,
                text: changed
                    ? fill(T.baseline.changed, { metric, from: metricValue(key, from), to: metricValue(key, to), direction: to > from ? T.baseline.up : T.baseline.down })
                    : fill(T.baseline.same, { metric, value: metricValue(key, to) }),
            }];
    });
}
/** Başlangıç profili hazır değilse durumu anlatan cümle */
export function baselineStatus(b, dateText) {
    if (b.status === 'forming')
        return fill(T.baseline.forming, { date: dateText(b.until) });
    if (b.status === 'not_enough')
        return fill(T.baseline.notEnough, { min: BASELINE_MIN_COUPONS });
    return null;
}
/** "Salı, Çarşamba ve Perşembe" */
export const joinTr = (xs) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} ve ${xs[xs.length - 1]}`);
/**
 * Bakiye oranı genel değerden anlamlı farklı olan günler ve saatler; her biri için yüksek ve düşük ayrı cümle.
 * Örnek: "Cumartesi (%2,0) günleri kupon başına kullandığınız bakiye oranı genel değerinizden yüksek (genel %1,6)."
 */
export function slotSentences(s) {
    const overall = s.overallRatio === null ? '—' : formatNumber(s.overallRatio * 100, 1);
    const group = (list, label, text) => ['higher', 'lower'].flatMap((dir) => {
        const items = list.filter((x) => x.changed === dir).map((x) => `${label(x.slot)} (${ratioText(x.avgRatio)})`);
        return items.length ? [fill(text, { slot: joinTr(items), direction: T.slots[dir], overall })] : [];
    });
    return [...group(s.days, (i) => DAY_NAMES[i], T.slots.changedDay), ...group(s.hours, hourSlotLabel, T.slots.changedHour)];
}
export const MIN_SLOT_TEXT = fill(T.slots.dataOnly, { min: MIN_SLOT_COUPONS });
