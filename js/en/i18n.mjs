// Sitede '@/i18n' yerine: tek dil (en), eksik anahtar Türkçesi (src/i18n/index.ts ile aynı davranış)
import { setNumberLanguage } from '/js/en/utils/format.mjs';
const D = {"date":{"today":"Today","tomorrow":"Tomorrow","yesterday":"Yesterday","monthsShort":["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"],"monthsLong":["January","February","March","April","May","June","July","August","September","October","November","December"],"weekdaysFromSunday":["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"],"weekdays":["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"],"weekdaysShort":["Mon","Tue","Wed","Thu","Fri","Sat","Sun"],"dayLabel":"{{weekday}} {{day}} {{month}}","shortDay":"{{day}} {{month}}","longDate":"{{day}} {{month}} {{year}}","monthsStandalone":["January","February","March","April","May","June","July","August","September","October","November","December"],"monthsShortStandalone":["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"]},"duration":{"minutes":"{{n}} min","hours":"{{n}} h","days":"{{n}} days"}};
const TR = {"date":{"today":"Bugün","tomorrow":"Yarın","yesterday":"Dün","monthsShort":["Oca","Şub","Mar","Nis","May","Haz","Tem","Ağu","Eyl","Eki","Kas","Ara"],"monthsLong":["Ocak","Şubat","Mart","Nisan","Mayıs","Haziran","Temmuz","Ağustos","Eylül","Ekim","Kasım","Aralık"],"weekdaysFromSunday":["Pazar","Pazartesi","Salı","Çarşamba","Perşembe","Cuma","Cumartesi"],"weekdays":["Pazartesi","Salı","Çarşamba","Perşembe","Cuma","Cumartesi","Pazar"],"weekdaysShort":["Pzt","Sal","Çar","Per","Cum","Cmt","Paz"],"dayLabel":"{{day}} {{month}} {{weekday}}","shortDay":"{{day}} {{month}}","longDate":"{{day}} {{month}} {{year}}","monthsStandalone":["Ocak","Şubat","Mart","Nisan","Mayıs","Haziran","Temmuz","Ağustos","Eylül","Ekim","Kasım","Aralık"],"monthsShortStandalone":["Oca","Şub","Mar","Nis","May","Haz","Tem","Ağu","Eyl","Eki","Kas","Ara"]},"duration":{"minutes":"{{n}} dk","hours":"{{n}} saat","days":"{{n}} gün"}};
export const lang = 'en';
export const locale = 'en-GB';
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
