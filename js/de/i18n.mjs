// Sitede '@/i18n' yerine: tek dil (de), eksik anahtar Türkçesi (src/i18n/index.ts ile aynı davranış)
import { setNumberLanguage } from '/js/de/utils/format.mjs';
const D = {"date":{"today":"Heute","tomorrow":"Morgen","yesterday":"Gestern","monthsShort":["Jan.","Feb.","März","Apr.","Mai","Juni","Juli","Aug.","Sep.","Okt.","Nov.","Dez."],"monthsLong":["Januar","Februar","März","April","Mai","Juni","Juli","August","September","Oktober","November","Dezember"],"weekdaysFromSunday":["Sonntag","Montag","Dienstag","Mittwoch","Donnerstag","Freitag","Samstag"],"weekdays":["Montag","Dienstag","Mittwoch","Donnerstag","Freitag","Samstag","Sonntag"],"weekdaysShort":["Mo","Di","Mi","Do","Fr","Sa","So"],"dayLabel":"{{weekday}}, {{day}}. {{month}}","shortDay":"{{day}}. {{month}}","longDate":"{{day}}. {{month}} {{year}}","monthsStandalone":["Januar","Februar","März","April","Mai","Juni","Juli","August","September","Oktober","November","Dezember"],"monthsShortStandalone":["Jan.","Feb.","März","Apr.","Mai","Juni","Juli","Aug.","Sep.","Okt.","Nov.","Dez."]},"duration":{"minutes":"{{n}} Min.","hours":"{{n}} Std.","days":"{{n}} Tage"}};
const TR = {"date":{"today":"Bugün","tomorrow":"Yarın","yesterday":"Dün","monthsShort":["Oca","Şub","Mar","Nis","May","Haz","Tem","Ağu","Eyl","Eki","Kas","Ara"],"monthsLong":["Ocak","Şubat","Mart","Nisan","Mayıs","Haziran","Temmuz","Ağustos","Eylül","Ekim","Kasım","Aralık"],"weekdaysFromSunday":["Pazar","Pazartesi","Salı","Çarşamba","Perşembe","Cuma","Cumartesi"],"weekdays":["Pazartesi","Salı","Çarşamba","Perşembe","Cuma","Cumartesi","Pazar"],"weekdaysShort":["Pzt","Sal","Çar","Per","Cum","Cmt","Paz"],"dayLabel":"{{day}} {{month}} {{weekday}}","shortDay":"{{day}} {{month}}","longDate":"{{day}} {{month}} {{year}}","monthsStandalone":["Ocak","Şubat","Mart","Nisan","Mayıs","Haziran","Temmuz","Ağustos","Eylül","Ekim","Kasım","Aralık"],"monthsShortStandalone":["Oca","Şub","Mar","Nis","May","Haz","Tem","Ağu","Eyl","Eki","Kas","Ara"]},"duration":{"minutes":"{{n}} dk","hours":"{{n}} saat","days":"{{n}} gün"}};
export const lang = 'de';
export const locale = 'de-DE';
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
