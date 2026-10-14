// Sitede '@/i18n' yerine: tek dil (pt), eksik anahtar Türkçesi (src/i18n/index.ts ile aynı davranış)
import { setNumberLanguage } from '/js/pt/utils/format.mjs';
const D = {"date":{"today":"Hoje","tomorrow":"Amanhã","yesterday":"Ontem","monthsShort":["jan","fev","mar","abr","mai","jun","jul","ago","set","out","nov","dez"],"monthsLong":["janeiro","fevereiro","março","abril","maio","junho","julho","agosto","setembro","outubro","novembro","dezembro"],"weekdaysFromSunday":["Domingo","Segunda-feira","Terça-feira","Quarta-feira","Quinta-feira","Sexta-feira","Sábado"],"weekdays":["Segunda-feira","Terça-feira","Quarta-feira","Quinta-feira","Sexta-feira","Sábado","Domingo"],"weekdaysShort":["Seg","Ter","Qua","Qui","Sex","Sáb","Dom"],"dayLabel":"{{weekday}}, {{day}} de {{month}}","shortDay":"{{day}} {{month}}","longDate":"{{day}} de {{month}} de {{year}}","monthsStandalone":["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"],"monthsShortStandalone":["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"]},"duration":{"minutes":"{{n}} min","hours":"{{n}} h","days":"{{n}} dias"}};
const TR = {"date":{"today":"Bugün","tomorrow":"Yarın","yesterday":"Dün","monthsShort":["Oca","Şub","Mar","Nis","May","Haz","Tem","Ağu","Eyl","Eki","Kas","Ara"],"monthsLong":["Ocak","Şubat","Mart","Nisan","Mayıs","Haziran","Temmuz","Ağustos","Eylül","Ekim","Kasım","Aralık"],"weekdaysFromSunday":["Pazar","Pazartesi","Salı","Çarşamba","Perşembe","Cuma","Cumartesi"],"weekdays":["Pazartesi","Salı","Çarşamba","Perşembe","Cuma","Cumartesi","Pazar"],"weekdaysShort":["Pzt","Sal","Çar","Per","Cum","Cmt","Paz"],"dayLabel":"{{day}} {{month}} {{weekday}}","shortDay":"{{day}} {{month}}","longDate":"{{day}} {{month}} {{year}}","monthsStandalone":["Ocak","Şubat","Mart","Nisan","Mayıs","Haziran","Temmuz","Ağustos","Eylül","Ekim","Kasım","Aralık"],"monthsShortStandalone":["Oca","Şub","Mar","Nis","May","Haz","Tem","Ağu","Eyl","Eki","Kas","Ara"]},"duration":{"minutes":"{{n}} dk","hours":"{{n}} saat","days":"{{n}} gün"}};
export const lang = 'pt';
export const locale = 'pt-BR';
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
