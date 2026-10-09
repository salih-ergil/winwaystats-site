import { locale, t, tList } from '/js/de/i18n.mjs';
const TR_OFFSET = 3 * 3600000;
const DAY = 24 * 3600000;
export const MONTHS_SHORT = tList('date.monthsShort');
export const MONTHS_LONG = tList('date.monthsLong');
/** Tarih dışında tek başına ay adı ("Ekim 2026"; Rusçada yalın hâl) */
export const MONTHS_STANDALONE = tList('date.monthsStandalone');
export const MONTHS_SHORT_STANDALONE = tList('date.monthsShortStandalone');
const WEEKDAYS = tList('date.weekdaysFromSunday');
/** Pazartesi'den başlayarak gün adları ve kısaltmaları */
export const WEEKDAY_NAMES = tList('date.weekdays');
export const WEEKDAYS_SHORT = tList('date.weekdaysShort');
/** Seçilen saat dilimindeki "duvar saati" (UTC alanlarıyla okunur) */
const tr = (d, zone = 'local') => {
    const ms = new Date(d).getTime();
    return new Date(ms + (zone === 'tr' ? TR_OFFSET : -new Date(ms).getTimezoneOffset() * 60000));
};
/** "2026-09-30" */
export function dayKey(d, zone = 'local') {
    return tr(d, zone).toISOString().slice(0, 10);
}
/** "20:30" */
export function timeOf(d, zone = 'local') {
    return tr(d, zone).toISOString().slice(11, 16);
}
const dayDiff = (d, now, zone) => Math.round((Date.parse(dayKey(d, zone)) - Date.parse(dayKey(now, zone))) / DAY);
/** "Bugün", "Yarın", "Dün" ya da "3 Ekim Cumartesi" */
export function dayLabel(d, now = new Date(), zone = 'local') {
    const diff = dayDiff(d, now, zone);
    if (diff === 0)
        return t('date.today');
    if (diff === 1)
        return t('date.tomorrow');
    if (diff === -1)
        return t('date.yesterday');
    const x = tr(d, zone);
    return t('date.dayLabel', { day: x.getUTCDate(), month: MONTHS_LONG[x.getUTCMonth()], weekday: WEEKDAYS[x.getUTCDay()] });
}
/** "Bugün, 20:30" */
export function kickoffLabel(d, now = new Date(), zone = 'local') {
    return `${dayLabel(d, now, zone)}, ${timeOf(d, zone)}`;
}
/** Kısa: "Bugün 20:30", "Yarın 14:30", "2 Eki 20:30" */
export function shortKickoff(d, now = new Date(), zone = 'local') {
    if (Math.abs(dayDiff(d, now, zone)) <= 1)
        return `${dayLabel(d, now, zone)} ${timeOf(d, zone)}`;
    const x = tr(d, zone);
    return `${t('date.shortDay', { day: x.getUTCDate(), month: MONTHS_SHORT[x.getUTCMonth()] })} ${timeOf(d, zone)}`;
}
/** "24 EYLÜL 2026" (maç detayı başlığı) */
export function longDate(d, zone = 'local') {
    const x = tr(d, zone);
    return t('date.longDate', { day: x.getUTCDate(), month: MONTHS_LONG[x.getUTCMonth()], year: x.getUTCFullYear() }).toLocaleUpperCase(locale);
}
/** "12.09.2026" */
export function shortDate(d, zone = 'local') {
    const x = tr(d, zone);
    return `${String(x.getUTCDate()).padStart(2, '0')}.${String(x.getUTCMonth() + 1).padStart(2, '0')}.${x.getUTCFullYear()}`;
}
