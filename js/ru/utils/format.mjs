/** Sayı biçiminin dili: uygulama açılışta i18n'den ayarlar (setNumberLanguage); sunucuda Türkçe kalır */
let numberLanguage = 'tr';
export function setNumberLanguage(language) {
    numberLanguage = language;
}
/** Binlik ve ondalık ayırıcı dile göre (Türkçe, Almanca, İspanyolca 1.234,5; İngilizce 1,234.5; Rusça 1 234,5) */
const SEPARATORS = {
    tr: { group: '.', decimal: ',' },
    de: { group: '.', decimal: ',' },
    es: { group: '.', decimal: ',' },
    en: { group: ',', decimal: '.' },
    ru: { group: '\u00a0', decimal: ',' },
};
/**
 * Sayıları uygulama dilinin biçiminde yazar (Türkçe: binlik nokta, ondalık virgül).
 * Intl'e güvenmek yerine elle yapılır; her telefonda aynı sonucu verir.
 */
export function formatNumber(value, decimals = 2, language = numberLanguage) {
    const { group, decimal } = SEPARATORS[language];
    const negative = value < 0;
    const [whole, fraction] = Math.abs(value).toFixed(decimals).split('.');
    const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, group);
    return `${negative ? '-' : ''}${grouped}${fraction ? `${decimal}${fraction}` : ''}`;
}
/**
 * Yüzde, dile göre: Türkçe %26,2 · İngilizce 26.2% · Almanca / İspanyolca 26,2 % · Rusça 26,2%.
 * sign: 'auto' eksi işareti (−), 'always' artı ya da eksi, 'none' işaretsiz (mutlak değer).
 */
export function formatPercent(value, decimals = 0, sign = 'auto') {
    const n = formatNumber(Math.abs(value), decimals);
    const body = numberLanguage === 'tr' ? `%${n}` : numberLanguage === 'de' || numberLanguage === 'es' ? `${n}\u00a0%` : `${n}%`;
    const prefix = sign === 'none' || value === 0 ? '' : value < 0 ? '−' : sign === 'always' ? '+' : '';
    return `${prefix}${body}`;
}
/** Sanal coin: ₵50.000,00 */
export function formatCoin(value) {
    return `₵${formatNumber(value, 2)}`;
}
/** Oran: 3.45 → "3.45" (oranlar tasarımda noktalı gösteriliyor) */
export function formatOdds(value) {
    return value.toFixed(2);
}
/** Kısa sayı (sıralama tablosu): 12.000 → "12K", -9.990 → "-9,99K", 84,9 → "84,9" */
export function formatCompact(value) {
    const { decimal } = SEPARATORS[numberLanguage];
    const trim = (s) => (s.includes(decimal) ? s.replace(/0+$/, '').replace(new RegExp(`\\${decimal}$`), '') : s);
    if (Math.abs(value) >= 1000)
        return `${trim(formatNumber(value / 1000, 2))}K`;
    return trim(formatNumber(value, 2)) || '0';
}
