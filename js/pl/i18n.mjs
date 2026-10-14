// Sitede '@/i18n' yerine: tek dil (pl), eksik anahtar Türkçesi (src/i18n/index.ts ile aynı davranış)
import { setNumberLanguage } from '/js/pl/utils/format.mjs';
const D = {"date":{"today":"Dziś","tomorrow":"Jutro","yesterday":"Wczoraj","monthsShort":["sty","lut","mar","kwi","maj","cze","lip","sie","wrz","paź","lis","gru"],"monthsLong":["stycznia","lutego","marca","kwietnia","maja","czerwca","lipca","sierpnia","września","października","listopada","grudnia"],"weekdaysFromSunday":["Niedziela","Poniedziałek","Wtorek","Środa","Czwartek","Piątek","Sobota"],"weekdays":["Poniedziałek","Wtorek","Środa","Czwartek","Piątek","Sobota","Niedziela"],"weekdaysShort":["Pn","Wt","Śr","Cz","Pt","Sb","Nd"],"dayLabel":"{{weekday}}, {{day}} {{month}}","shortDay":"{{day}} {{month}}","longDate":"{{day}} {{month}} {{year}}","monthsStandalone":["Styczeń","Luty","Marzec","Kwiecień","Maj","Czerwiec","Lipiec","Sierpień","Wrzesień","Październik","Listopad","Grudzień"],"monthsShortStandalone":["Sty","Lut","Mar","Kwi","Maj","Cze","Lip","Sie","Wrz","Paź","Lis","Gru"]},"duration":{"minutes":"{{n}} min","hours":"{{n}} godz.","days":"{{n}} dni"}};
const TR = {"date":{"today":"Bugün","tomorrow":"Yarın","yesterday":"Dün","monthsShort":["Oca","Şub","Mar","Nis","May","Haz","Tem","Ağu","Eyl","Eki","Kas","Ara"],"monthsLong":["Ocak","Şubat","Mart","Nisan","Mayıs","Haziran","Temmuz","Ağustos","Eylül","Ekim","Kasım","Aralık"],"weekdaysFromSunday":["Pazar","Pazartesi","Salı","Çarşamba","Perşembe","Cuma","Cumartesi"],"weekdays":["Pazartesi","Salı","Çarşamba","Perşembe","Cuma","Cumartesi","Pazar"],"weekdaysShort":["Pzt","Sal","Çar","Per","Cum","Cmt","Paz"],"dayLabel":"{{day}} {{month}} {{weekday}}","shortDay":"{{day}} {{month}}","longDate":"{{day}} {{month}} {{year}}","monthsStandalone":["Ocak","Şubat","Mart","Nisan","Mayıs","Haziran","Temmuz","Ağustos","Eylül","Ekim","Kasım","Aralık"],"monthsShortStandalone":["Oca","Şub","Mar","Nis","May","Haz","Tem","Ağu","Eyl","Eki","Kas","Ara"]},"duration":{"minutes":"{{n}} dk","hours":"{{n}} saat","days":"{{n}} gün"}};
export const lang = 'pl';
export const locale = 'pl-PL';
setNumberLanguage(lang);
const lookup = (d, k) => k.split('.').reduce((n, p) => n?.[p], d);
export function t(key, params) {
  let v = lookup(D, key);
  if (typeof v !== 'string') v = lookup(TR, key);
  if (typeof v !== 'string') return key;
  return params ? v.replace(/\{\{(\w+)\}\}/g, (_, n) => String(params[n] ?? '')) : v;
}
export function tOptional(key, params) { const v = lookup(D, key) ?? lookup(TR, key); return typeof v === 'string' ? t(key, params) : undefined; }
export function tList(key) { const v = lookup(D, key) ?? lookup(TR, key); return Array.isArray(v) ? v : []; }
export function byLang(variants) { return variants[lang] ?? variants.tr; }
