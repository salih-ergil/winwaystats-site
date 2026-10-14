// Sitede '@/i18n' yerine: tek dil (fr), eksik anahtar Türkçesi (src/i18n/index.ts ile aynı davranış)
import { setNumberLanguage } from '/js/fr/utils/format.mjs';
const D = {"date":{"today":"Aujourd'hui","tomorrow":"Demain","yesterday":"Hier","monthsShort":["janv.","févr.","mars","avr.","mai","juin","juil.","août","sept.","oct.","nov.","déc."],"monthsLong":["janvier","février","mars","avril","mai","juin","juillet","août","septembre","octobre","novembre","décembre"],"weekdaysFromSunday":["Dimanche","Lundi","Mardi","Mercredi","Jeudi","Vendredi","Samedi"],"weekdays":["Lundi","Mardi","Mercredi","Jeudi","Vendredi","Samedi","Dimanche"],"weekdaysShort":["Lun","Mar","Mer","Jeu","Ven","Sam","Dim"],"dayLabel":"{{weekday}} {{day}} {{month}}","shortDay":"{{day}} {{month}}","longDate":"{{day}} {{month}} {{year}}","monthsStandalone":["Janvier","Février","Mars","Avril","Mai","Juin","Juillet","Août","Septembre","Octobre","Novembre","Décembre"],"monthsShortStandalone":["Janv.","Févr.","Mars","Avr.","Mai","Juin","Juil.","Août","Sept.","Oct.","Nov.","Déc."]},"duration":{"minutes":"{{n}} min","hours":"{{n}} h","days":"{{n}} jours"}};
const TR = {"date":{"today":"Bugün","tomorrow":"Yarın","yesterday":"Dün","monthsShort":["Oca","Şub","Mar","Nis","May","Haz","Tem","Ağu","Eyl","Eki","Kas","Ara"],"monthsLong":["Ocak","Şubat","Mart","Nisan","Mayıs","Haziran","Temmuz","Ağustos","Eylül","Ekim","Kasım","Aralık"],"weekdaysFromSunday":["Pazar","Pazartesi","Salı","Çarşamba","Perşembe","Cuma","Cumartesi"],"weekdays":["Pazartesi","Salı","Çarşamba","Perşembe","Cuma","Cumartesi","Pazar"],"weekdaysShort":["Pzt","Sal","Çar","Per","Cum","Cmt","Paz"],"dayLabel":"{{day}} {{month}} {{weekday}}","shortDay":"{{day}} {{month}}","longDate":"{{day}} {{month}} {{year}}","monthsStandalone":["Ocak","Şubat","Mart","Nisan","Mayıs","Haziran","Temmuz","Ağustos","Eylül","Ekim","Kasım","Aralık"],"monthsShortStandalone":["Oca","Şub","Mar","Nis","May","Haz","Tem","Ağu","Eyl","Eki","Kas","Ara"]},"duration":{"minutes":"{{n}} dk","hours":"{{n}} saat","days":"{{n}} gün"}};
export const lang = 'fr';
export const locale = 'fr-FR';
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
