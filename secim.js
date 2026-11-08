// Aramalı seçim kutusu (Salih, 2026-10-23): ülke, şehir ve telefon kodu elle yazılmaz, listeden aranarak seçilir.
// Kullanım: const p = picker(kapsayıcı, { name, items: [{ v, l, s? }], placeholder, search, empty, onChange });
//   v: kaydedilen değer · l: listede görünen · s: seçilince kutuda görünen (yoksa l). Değer gizli bir alana yazılır (form ile gider).
// Arama Türkçe harf ve büyük-küçük harf farkı gözetmez ("istanbul" = "İstanbul"). Listeler: /geo/ (scripts/geo-veri.mjs).
const norm = (t) => String(t).toLocaleLowerCase('tr').replace(/ı/g, 'i').normalize('NFD').replace(/[̀-ͯ]/g, '');
const esc = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const MAX = 200;

export function picker(root, opt) {
  let items = opt.items ?? [];
  let value = opt.value ?? '';
  let active = 0;
  root.classList.add('pk');
  root.innerHTML = `<input type="hidden" name="${esc(opt.name)}"><button type="button" class="pk-btn" aria-haspopup="listbox"><span class="pk-label"></span><span class="pk-arrow" aria-hidden="true"></span></button>
<div class="pk-pop" hidden><input class="pk-q" type="search" autocomplete="off" placeholder="${esc(opt.search ?? '')}"><ul class="pk-list" role="listbox"></ul></div>`;
  const hidden = root.querySelector('input[type=hidden]');
  const btn = root.querySelector('.pk-btn');
  const label = root.querySelector('.pk-label');
  const pop = root.querySelector('.pk-pop');
  const q = root.querySelector('.pk-q');
  const list = root.querySelector('.pk-list');

  const shown = () => {
    const k = norm(q.value.trim());
    return (k ? items.filter((i) => norm(i.l).includes(k)) : items).slice(0, MAX);
  };
  const paint = () => {
    const sel = items.find((i) => i.v === value);
    hidden.value = value;
    label.textContent = sel ? sel.s ?? sel.l : opt.placeholder ?? '';
    label.classList.toggle('pk-ph', !sel);
    btn.disabled = !items.length;
  };
  const renderList = () => {
    const rows = shown();
    active = Math.min(active, Math.max(0, rows.length - 1));
    list.innerHTML = rows.length
      ? rows.map((i, n) => `<li role="option" data-v="${esc(i.v)}" class="${n === active ? 'on' : ''}${i.v === value ? ' sel' : ''}" aria-selected="${i.v === value}">${esc(i.l)}</li>`).join('')
      : `<li class="pk-empty">${esc(opt.empty ?? '–')}</li>`;
  };
  const open = () => {
    pop.hidden = false;
    root.classList.add('open');
    q.value = '';
    active = Math.max(0, shown().findIndex((i) => i.v === value));
    renderList();
    list.querySelector('.on')?.scrollIntoView({ block: 'nearest' });
    q.focus();
  };
  const close = () => {
    pop.hidden = true;
    root.classList.remove('open');
  };
  const choose = (v) => {
    value = v;
    paint();
    close();
    btn.focus();
    opt.onChange?.(v);
  };

  btn.addEventListener('click', () => (pop.hidden ? open() : close()));
  q.addEventListener('input', () => {
    active = 0;
    renderList();
  });
  q.addEventListener('keydown', (e) => {
    const rows = shown();
    if (e.key === 'ArrowDown') active = Math.min(rows.length - 1, active + 1);
    else if (e.key === 'ArrowUp') active = Math.max(0, active - 1);
    else if (e.key === 'Enter') {
      e.preventDefault();
      if (rows[active]) choose(rows[active].v);
      return;
    } else if (e.key === 'Escape') return close();
    else return;
    e.preventDefault();
    renderList();
    list.querySelector('.on')?.scrollIntoView({ block: 'nearest' });
  });
  list.addEventListener('mousedown', (e) => e.preventDefault());
  list.addEventListener('click', (e) => {
    const li = e.target.closest('li[data-v]');
    if (li) choose(li.dataset.v);
  });
  document.addEventListener('click', (e) => !root.contains(e.target) && close());
  paint();

  return {
    get value() {
      return value;
    },
    set(v) {
      value = v;
      paint();
    },
    setItems(next, v = '', placeholder) {
      items = next;
      value = v;
      if (placeholder != null) opt.placeholder = placeholder;
      paint();
    },
  };
}

// Listeler: ülkeler bir kez, şehirler ülke seçilince yüklenir
let countriesCache;
export async function loadCountries() {
  countriesCache ??= fetch('/geo/countries.json').then((r) => r.json());
  return countriesCache;
}
export async function loadCities(cc) {
  if (!cc) return [];
  const r = await fetch(`/geo/cities/${encodeURIComponent(cc)}.json`);
  return r.ok ? r.json() : [];
}

export const PICKER_CSS = `.pk{position:relative}.pk-btn{width:100%;display:flex;align-items:center;justify-content:space-between;gap:8px;background:var(--surface);border:1px solid var(--border);color:var(--text);border-radius:10px;padding:12px;font:inherit;font-size:16px;font-weight:400;text-align:left;min-height:48px;cursor:pointer}.pk-btn:disabled{opacity:.55;cursor:default}.pk-label{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.pk-ph{color:var(--muted)}.pk-arrow{width:10px;height:10px;border-right:2px solid var(--muted);border-bottom:2px solid var(--muted);transform:rotate(45deg) translate(-2px,-2px);flex:none}.pk.open .pk-arrow{transform:rotate(-135deg)}.pk-pop{position:absolute;z-index:60;left:0;right:0;top:calc(100% + 4px);background:var(--surface);border:1px solid var(--border);border-radius:12px;box-shadow:0 12px 32px rgba(0,0,0,.35);padding:8px}.pk-q{width:100%;box-sizing:border-box;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:8px;padding:10px;font-size:16px}.pk-list{list-style:none;margin:6px 0 0;padding:0;max-height:260px;overflow-y:auto}.pk-list li{padding:9px 10px;border-radius:8px;cursor:pointer;color:var(--text);font-size:15px}.pk-list li.on{background:var(--surface-high)}.pk-list li.sel{color:var(--green);font-weight:600}.pk-empty{color:var(--muted)!important;cursor:default!important}.k-dial .pk-pop{right:auto;width:min(340px,86vw)}`;
