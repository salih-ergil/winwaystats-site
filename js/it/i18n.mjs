// Sitede '@/i18n' yerine: tek dil (it), eksik anahtar Türkçesi (src/i18n/index.ts ile aynı davranış)
import { setNumberLanguage } from '/js/it/utils/format.mjs';
const D = {"date":{"today":"Oggi","tomorrow":"Domani","yesterday":"Ieri","monthsShort":["gen","feb","mar","apr","mag","giu","lug","ago","set","ott","nov","dic"],"monthsLong":["gennaio","febbraio","marzo","aprile","maggio","giugno","luglio","agosto","settembre","ottobre","novembre","dicembre"],"weekdaysFromSunday":["Domenica","Lunedì","Martedì","Mercoledì","Giovedì","Venerdì","Sabato"],"weekdays":["Lunedì","Martedì","Mercoledì","Giovedì","Venerdì","Sabato","Domenica"],"weekdaysShort":["Lun","Mar","Mer","Gio","Ven","Sab","Dom"],"dayLabel":"{{weekday}} {{day}} {{month}}","shortDay":"{{day}} {{month}}","longDate":"{{day}} {{month}} {{year}}","monthsStandalone":["Gennaio","Febbraio","Marzo","Aprile","Maggio","Giugno","Luglio","Agosto","Settembre","Ottobre","Novembre","Dicembre"],"monthsShortStandalone":["Gen","Feb","Mar","Apr","Mag","Giu","Lug","Ago","Set","Ott","Nov","Dic"]},"duration":{"minutes":"{{n}} min","hours":"{{n}} h","days":"{{n}} giorni"}};
const TR = {"date":{"today":"Bugün","tomorrow":"Yarın","yesterday":"Dün","monthsShort":["Oca","Şub","Mar","Nis","May","Haz","Tem","Ağu","Eyl","Eki","Kas","Ara"],"monthsLong":["Ocak","Şubat","Mart","Nisan","Mayıs","Haziran","Temmuz","Ağustos","Eylül","Ekim","Kasım","Aralık"],"weekdaysFromSunday":["Pazar","Pazartesi","Salı","Çarşamba","Perşembe","Cuma","Cumartesi"],"weekdays":["Pazartesi","Salı","Çarşamba","Perşembe","Cuma","Cumartesi","Pazar"],"weekdaysShort":["Pzt","Sal","Çar","Per","Cum","Cmt","Paz"],"dayLabel":"{{day}} {{month}} {{weekday}}","shortDay":"{{day}} {{month}}","longDate":"{{day}} {{month}} {{year}}","monthsStandalone":["Ocak","Şubat","Mart","Nisan","Mayıs","Haziran","Temmuz","Ağustos","Eylül","Ekim","Kasım","Aralık"],"monthsShortStandalone":["Oca","Şub","Mar","Nis","May","Haz","Tem","Ağu","Eyl","Eki","Kas","Ara"]},"duration":{"minutes":"{{n}} dk","hours":"{{n}} saat","days":"{{n}} gün"}};
export const lang = 'it';
export const locale = 'it-IT';
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
