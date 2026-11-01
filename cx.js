/* Sistema CONEXIONADO: se alimenta de la pestaña CONEXIONADO del Sheet.
   Las columnas con cabecera verde son editables; el resto viene con fórmulas y solo se lee.
   Filas y columnas se leen tal cual están, así que la tabla puede crecer sin tocar la app.
   Las ediciones se guardan en el teléfono, se suben solas (aunque no haya cobertura) y quedan en el historial. */
const CX = { data: null, ci: new Map(), ti: 0, idx: new Map(), hay: [], q: [], qText: '', st: '', lim: 120, sel: '', draft: {}, pulling: false };

const cxStCls = s => { s = String(s || '').toUpperCase(); return s === 'IMPUTADO' ? 'st-ok' : (s === 'FALTA' || s === 'NO ENCONTRADO') ? 'st-bad' : (s === '' || s === 'REASIGNADO') ? 'st-na' : 'st-warn'; };
const cxToday = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const cxCol = n => CX.ci.get(n);
const cxCan = () => typeof canConex === 'function' && canConex();
const cxAdm = () => typeof cloud !== 'undefined' && cloud.admin && cloud.admin();
const cxIsWeek = n => /SEM|WEEK/i.test(n);
const cxGrp = c => /^OBSERV/i.test(c.name) ? '' : String(c.group || '').toUpperCase();
/* una sección FROM / TO con STATUS IMPUTADO queda bloqueada (solo la edita el administrador) */
function cxLocked(g, r) { if (g !== 'FROM' && g !== 'TO') return false; const si = cxCol('STATUS_' + g); return si !== undefined && r[si] === 'IMPUTADO'; }
function cxWeekNum(s) { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || ''); if (!m) return ''; const t = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])), dn = t.getUTCDay() || 7; t.setUTCDate(t.getUTCDate() + 4 - dn); return String(Math.ceil(((t - Date.UTC(t.getUTCFullYear(), 0, 1)) / 864e5 + 1) / 7)); }

function setCx(d) {
  CX.data = d;
  CX.ci = new Map(d.cols.map((c, i) => [c.name, i]));
  CX.ti = CX.ci.get('CABLE_NUMBER');
  CX.idx = new Map();
  d.rows.forEach((r, i) => CX.idx.set(norm(r[CX.ti]), i));
  cxApplyQueue();
  CX.hay = d.rows.map(r => r.join(' ').toLowerCase());
}
function cxApplyQueue() {
  CX.q.filter(x => !x.synced).forEach(x => {
    const i = CX.idx.get(norm(x.cable)); if (i === undefined) return;
    for (const [k, v] of Object.entries(x.changes)) { const ci = CX.ci.get(k); if (ci !== undefined) CX.data.rows[i][ci] = v; }
  });
}
async function loadCx() {
  CX.q = (await DB.get('meta', 'conexQ').catch(() => null)) || [];
  const d = await DB.get('meta', 'conex').catch(() => null);
  if (d && d.cols) setCx(d);
  cxRepaint();
}
async function pullCx(silent) {
  if (!cloud.on()) return false;
  CX.pulling = true;
  try {
    const j = await apiGet('conex', CX.data && CX.data.hash ? { hash: CX.data.hash } : {});
    if (j.none) { CX.none = true; return true; }
    if (j.same) return true;
    await DB.put('meta', j, 'conex');
    setCx(j); cxRepaint();
    return true;
  } catch (e) {
    if (!silent) toast('No se pudo leer el conexionado: ' + e.message, 5000);
    return false;
  } finally { CX.pulling = false; }
}
/* sube las ediciones pendientes (en orden) y trae lo de los demás */
async function cxSync(force) {
  if (!cloud.on() || !navigator.onLine || cxSync.busy) return;
  cxSync.busy = true;
  try {
    for (const it of CX.q.filter(x => !x.synced)) {
      try { await apiPost('setConex', { id: it.id, cable: it.cable, changes: it.changes, author: cloud.author() }); it.synced = true; }
      catch (e) {
        if (/permiso|no está en|no se puede editar|no válido|Falta|administrador|IMPUTADA/.test(e.message)) { it.synced = true; toast(`No se pudo guardar ${it.cable}: ${e.message}`, 6000); }
        else throw e;   // sin cobertura: se reintenta luego
      }
    }
    const had = CX.q.length; CX.q = CX.q.filter(x => !x.synced); if (had !== CX.q.length) await DB.put('meta', CX.q, 'conexQ');
    if (force || had !== CX.q.length || $('#app').dataset.mod === 'con' || !CX.data) await pullCx(true);
  } catch { /* sin cobertura */ }
  finally { cxSync.busy = false; if (CX.data) cxRepaint(); }
}
const cxPending = () => CX.q.filter(x => !x.synced).length;

async function cxSave(tag, changes) {
  const i = CX.idx.get(norm(tag)); if (i === undefined) return;
  const before = {}; for (const k of Object.keys(changes)) before[k] = CX.data.rows[i][CX.ci.get(k)] || '';
  const it = { id: newUid(), cable: tag, changes, before, date: new Date().toISOString(), author: cloud.author(), synced: false };
  CX.q.push(it); await DB.put('meta', CX.q, 'conexQ');
  for (const [k, v] of Object.entries(changes)) CX.data.rows[i][CX.ci.get(k)] = v;
  CX.hay[i] = CX.data.rows[i].join(' ').toLowerCase(); CX.draft = {};
  cxRepaint(); toast('Cambios guardados' + (cloud.on() && !navigator.onLine ? ' en este dispositivo. Sin cobertura: se subirán solos' : ''));
  cxSync(true);
}
const cxHas = tag => !!CX.data && CX.idx.has(norm(tag));

/* ---------- Buscar ---------- */
function cxSides(r) {
  const f = cxCol('STATUS_FROM'), t = cxCol('STATUS_TO');
  return [f !== undefined ? r[f] : '', t !== undefined ? r[t] : ''];
}
function cxHits() {
  const q = CX.qText.trim().toLowerCase(), out = [];
  CX.data.rows.forEach((r, i) => {
    if (CX.st) { const [a, b] = cxSides(r); if (CX.st === '(sin status)' ? (a || b) : (a !== CX.st && b !== CX.st)) return; }
    if (q && !q.split(/\s+/).every(w => CX.hay[i].includes(w))) return;
    out.push(i);
  });
  return out;
}
function renderCxSearch() {
  const root = $('#cxSearch'); if (!root) return;
  if (!CX.data) {
    $('#cxInfo').textContent = '';
    root.innerHTML = `<div class="d-empty"><h2>${CX.none ? 'No hay datos de conexionado' : 'Conexionado sin descargar'}</h2><p>${CX.none ? 'Falta la pestaña CONEXIONADO en tu Google Sheet.' : cloud.on() ? 'Pulsa Actualizar cuando tengas cobertura. Después funciona sin conexión.' : 'Conecta tu Google para descargar el conexionado.'}</p>${cloud.on() ? '<button class="btn primary" id="cxPull">Descargar ahora</button>' : ''}</div>`;
    return;
  }
  const d = CX.data, hits = cxHits(), shown = hits.slice(0, CX.lim);
  const counts = new Map(); d.rows.forEach(r => { const [a, b] = cxSides(r); new Set([a || '(sin status)', b || '(sin status)']).forEach(s => counts.set(s, (counts.get(s) || 0) + 1)); });
  const ests = [...new Set([...(d.estados || []), ...counts.keys()])].filter(s => counts.has(s));
  $('#cxInfo').textContent = `${d.rows.length.toLocaleString('es-ES')} cables`;
  const pend = cxPending();
  if (!$('#cxQ')) {
    root.innerHTML = `<label class="field"><span>Buscar cable, tag, área u observación</span><input id="cxQ" type="search" placeholder="Parte del tag, por ejemplo CKA32-BR03" autocomplete="off" value="${esc(CX.qText)}"></label>
      <div class="filters" id="cxChips"></div><p class="help" id="cxCount"></p><div id="cxRes" class="rows"></div>`;
  }
  $('#cxChips').innerHTML = `<button class="filter ${CX.st === '' ? 'on' : ''}" data-st="">Todos ${d.rows.length}</button>` + ests.map(s => `<button class="filter ${CX.st === s ? 'on' : ''}" data-st="${esc(s)}">${esc(s === '(sin status)' ? 'Sin status' : sentence(s))} ${counts.get(s)}</button>`).join('');
  $('#cxCount').textContent = `${hits.length.toLocaleString('es-ES')} de ${d.rows.length.toLocaleString('es-ES')}${pend ? ` · ${pend} cambio${pend > 1 ? 's' : ''} por subir` : ''}`;
  $('#cxRes').innerHTML = shown.map(i => {
    const r = d.rows[i], [a, b] = cxSides(r), tag = r[CX.ti];
    const cls = (a === 'IMPUTADO' && b === 'IMPUTADO') ? 'st-ok' : [a, b].some(x => cxStCls(x) === 'st-bad') ? 'st-bad' : 'st-warn';
    const ft = cxCol('From_Tag'), tt = cxCol('To_Tag');
    const sub = ft !== undefined && tt !== undefined ? `${String(r[ft] || '?').replace(/^#HKF\./, '')} → ${String(r[tt] || '?').replace(/^#HKF\./, '')}` : '';
    return `<button class="row ${cls} ${norm(tag) === norm(CX.sel) ? 'sel' : ''}" data-cx-open="${esc(tag)}"><span class="t">${esc(tag)}</span>
      <span class="m"><span class="cx-pill ${cxStCls(a)}">De: ${esc(a ? sentence(a) : 'sin status')}</span><span class="cx-pill ${cxStCls(b)}">A: ${esc(b ? sentence(b) : 'sin status')}</span></span>${sub ? `<span class="m"><span>${esc(sub)}</span></span>` : ''}</button>`;
  }).join('') || '<p class="empty">Ningún cable coincide. Prueba con otra parte del texto o quita el filtro.</p>';
  if (hits.length > shown.length) $('#cxRes').insertAdjacentHTML('beforeend', `<button class="btn more" id="cxMore">Mostrar más (${(hits.length - shown.length).toLocaleString('es-ES')} restantes)</button>`);
}

/* ---------- Ficha ---------- */
function openCx(tag) {
  if (!CX.data || !cxHas(tag)) return;
  CX.sel = tag; CX.draft = {}; current = -1; curSched = -1;
  $('#view').classList.add('open'); $('#vAddList').hidden = true;
  if (typeof cam !== 'undefined') cam.paused = !isWide();
  if (!isWide() && !(history.state && history.state.detail)) history.pushState({ detail: 1 }, '');
  renderCx();
  renderCxSearch();
}
function cxEmpty() { CX.sel = ''; $('#vBody').innerHTML = '<div class="d-empty"><h2>Ningún cable abierto</h2><p>Busca un cable y aquí verás sus datos de conexionado y podrás editar los campos verdes.</p></div>'; $('#vAddList').hidden = true; }
function cxHistory(tag) {
  const k = norm(tag), out = [];
  (CX.data.log || []).forEach(e => { if (norm(e[1]) === k) out.push({ date: e[0], col: e[2], from: e[3], to: e[4], who: e[5] }); });
  CX.q.filter(x => !x.synced && norm(x.cable) === k).forEach(x => Object.entries(x.changes).forEach(([c, v]) => out.push({ date: x.date.slice(0, 16).replace('T', ' '), col: c, from: (x.before || {})[c] || '', to: v, who: x.author, pend: true })));
  return out.sort((a, b) => b.date.localeCompare(a.date));
}
/* STATUS_FROM y STATUS_TO usan la lista del Sheet; otros STATUS (por ejemplo STATUS_CONEX) usan los valores que ya tiene su columna */
function cxOptions(name) {
  if (/^STATUS_(FROM|TO)$/i.test(name)) return CX.data.estados || [];
  const ci = cxCol(name); return [...new Set(CX.data.rows.map(r => r[ci]).filter(Boolean))].sort();
}
function cxInput(c, v, can, keep) {
  const val = CX.draft[c.name] !== undefined ? CX.draft[c.name] : v;
  if (!c.edit || !can) return `<span class="v ${v ? '' : 'none'}">${v ? esc(fmtVal(v)) : 'Sin dato'}</span>`;
  const id = 'cxf_' + c.name;
  if (/^STATUS/i.test(c.name)) return `<div class="chips cx-opts" data-f="${esc(c.name)}">${[...(keep && !cxAdm() ? [] : ['']), ...cxOptions(c.name)].map(s => `<button type="button" class="filter ${val === s ? 'on' : ''}" data-cx-set="${esc(s)}">${s ? esc(sentence(s)) : 'Vacío'}</button>`).join('')}</div>`;
  if (/^FECHA/i.test(c.name)) return `<input id="${id}" data-f="${esc(c.name)}" type="date" value="${esc(val)}">`;
  if (/OBSERV/i.test(c.name)) return `<textarea id="${id}" data-f="${esc(c.name)}" rows="3">${esc(val)}</textarea>`;
  return `<input id="${id}" data-f="${esc(c.name)}" type="text" inputmode="text" value="${esc(val)}" autocomplete="off">`;
}
function renderCx(keepFocus) {
  if (!CX.data || !CX.sel) return;
  const d = CX.data, i = CX.idx.get(norm(CX.sel)); if (i === undefined) return cxEmpty();
  const r = d.rows[i], tag = r[CX.ti], can = cxCan(), dirty = Object.keys(CX.draft).length;
  const groups = []; const gmap = new Map();
  d.cols.forEach((c, ci) => {
    if (ci === CX.ti) return;
    const g = /^OBSERV/i.test(c.name) ? '' : (c.group || '');
    if (!gmap.has(g)) { const o = { g, cols: [] }; gmap.set(g, o); groups.push(o); }
    gmap.get(g).cols.push([c, ci]);
  });
  const cxEd = (c, r) => c.edit && can && !cxIsWeek(c.name) && (cxAdm() || !cxLocked(cxGrp(c), r));
  groups.forEach(o => o.cols.sort((p, q) => cxEd(q[0], r) - cxEd(p[0], r)));   // primero lo editable
  groups.sort((a, b) => (a.g === '') - (b.g === ''));
  const gname = g => g === 'FROM' ? 'Origen (From)' : g === 'TO' ? 'Destino (To)' : g ? g : 'General';
  const card = o => `<section class="cx-card ${o.g === 'FROM' ? 'from' : o.g === 'TO' ? 'to' : ''}"><h3>${esc(gname(o.g))}${cxLocked(String(o.g).toUpperCase(), r) ? ' <small class="muted">imputado' + (cxAdm() ? '' : ', bloqueado') + '</small>' : ''}</h3>${o.cols.map(([c, ci]) => {
    const label = `<span class="n">${esc(c.name.replace(/_/g, ' '))}</span>`;
    const g = cxGrp(c), lock = cxLocked(g, r) && !cxAdm();
    if (cxIsWeek(c.name)) {   // la semana se calcula sola desde la fecha del mismo lado
      const fc = d.cols.findIndex(z => /^FECHA_/i.test(z.name) && cxGrp(z) === g), dv = fc >= 0 ? (CX.draft[d.cols[fc].name] !== undefined ? CX.draft[d.cols[fc].name] : r[fc]) : '', wv = cxWeekNum(dv) || r[ci];
      return `<div class="kv"><span class="l">${esc(c.letter)}</span>${label}<span class="v ${wv ? '' : 'none'}">${wv ? esc(wv) + ' <small class="muted">automática</small>' : 'Sin dato'}</span></div>`;
    }
    return c.edit && can && !lock ? `<div class="cx-f ed"><label>${label}${c.edit ? '<i class="cx-dot" title="Campo editable"></i>' : ''}</label>${cxInput(c, r[ci], can, !!r[ci])}</div>`
      : `<div class="kv"><span class="l">${esc(c.letter)}</span>${label}${cxInput(c, r[ci], false)}</div>`;
  }).join('')}</section>`;
  const hist = cxHistory(tag);
  const inCab = typeof IDX !== 'undefined' && DATA && IDX.has(norm(tag));
  $('#vBody').innerHTML = `
    <div class="d-top"><div class="marker"><span class="sleeve"></span><span class="mk-body"><b>${esc(tag)}</b></span><button class="btn small quiet copy" id="cxCopy">Copiar</button></div></div>
    ${can ? '' : '<p class="help">Tu código solo permite leer el conexionado.</p>'}
    <div class="cx-sides">${groups.map(card).join('')}</div>
    ${can ? `<div class="cx-save"><button class="btn primary" id="cxSaveBtn" ${dirty ? '' : 'disabled'}>Guardar cambios${dirty ? ` (${dirty})` : ''}</button><button class="btn" id="cxDiscard" ${dirty ? '' : 'disabled'}>Descartar</button><span class="muted">Se guarda con tu nombre y la fecha.</span></div>` : ''}
    ${inCab ? '<div class="btn-row"><button class="btn" id="cxToCab">Abrir en Cableado</button></div>' : ''}
    <section class="cx-hist"><h3>Historial de cambios <small class="muted">${hist.length}</small></h3>
      ${hist.map(h => `<div class="fs-row"><div><div><b>${esc(h.col.replace(/_/g, ' '))}</b>: ${h.from ? esc(fmtVal(h.from)) : '<i>vacío</i>'} → ${h.to ? esc(fmtVal(h.to)) : '<i>vacío</i>'}</div><small>${esc(h.date)}${h.who ? ', ' + esc(h.who) : ''}${h.pend ? ' <span class="sync wait">Pendiente de subir</span>' : ''}</small></div>${cxAdm() && can && !h.pend && cxCol(h.col) !== undefined ? `<button class="btn small quiet" data-cx-undo="${esc(h.col)}" data-v="${esc(h.from)}">Deshacer</button>` : ''}</div>`).join('') || '<p class="empty">Todavía no hay cambios hechos desde la app.</p>'}
    </section>`;
}

/* ---------- Resumen ---------- */
/* STATUS_CONEX = el cable está conectado en ambas puntas o no (cuenta cables, no extremos) */
function cxConexBlock(d, n) {
  const ci = cxCol('STATUS_CONEX'); if (ci === undefined || !n) return '';
  const m = new Map(); d.rows.forEach(r => { const s = r[ci] || '(sin status)'; m.set(s, (m.get(s) || 0) + 1); });
  const list = [...m].sort((a, b) => b[1] - a[1]);
  return `<p class="chart-t">Conexión del cable (ambas puntas)</p>
    <div class="cx-tab">
    ${list.map(([k, v]) => `<div class="cx-line"><span class="cx-lbl"><i class="cx-dotc ${cxStCls(k === '(sin status)' ? '' : k)}"></i>${esc(k === '(sin status)' ? 'Sin status' : sentence(k))}</span><span class="cx-two"><span class="cx-side">${bar2(v, n, k)}<b>${v}</b> <small>${(v / n * 100).toFixed(0)}%</small></span></span></div>`).join('')}</div>`;
}
function bar2(v, n, k) { return `<div class="cx-bar"><span class="cx-seg ${k ? cxStCls(k === '(sin status)' ? '' : k) : ''}" style="--w:${n ? v / n * 100 : 0}%"></span></div>`; }

function renderCxStats() {
  const root = $('#cxStats'); if (!root) return;
  if (!CX.data) { $('#cxInfo2').textContent = ''; root.innerHTML = '<div class="d-empty"><h2>Sin datos de conexionado</h2><p>Descarga el conexionado desde la pestaña Buscar.</p></div>'; return; }
  const d = CX.data, n = d.rows.length, sf = cxCol('STATUS_FROM'), st = cxCol('STATUS_TO'), df = cxCol('FECHA_STATUS_FROM'), dt = cxCol('FECHA_STATUS_TO');
  $('#cxInfo2').textContent = d.generado ? 'Datos del ' + d.generado : '';
  const cnt = (ci) => { const m = new Map(); d.rows.forEach(r => { const s = r[ci] || '(sin status)'; m.set(s, (m.get(s) || 0) + 1); }); return m; };
  const A = sf !== undefined ? cnt(sf) : new Map(), B = st !== undefined ? cnt(st) : new Map();
  const imp = (A.get('IMPUTADO') || 0) + (B.get('IMPUTADO') || 0), ext = n * 2, pct = ext ? imp / ext * 100 : 0;
  const both = d.rows.filter(r => r[sf] === 'IMPUTADO' && r[st] === 'IMPUTADO').length;
  const falta = (A.get('FALTA') || 0) + (B.get('FALTA') || 0), pen = [...A, ...B].filter(([k]) => /PENDING|POR IMPUTAR/.test(k)).reduce((s, [, v]) => s + v, 0);
  const all = [...new Set([...(d.estados || []), ...A.keys(), ...B.keys()])].filter(s => A.has(s) || B.has(s));
  const bar = (m, s) => `<div class="cx-bar"><span class="cx-seg ${cxStCls(s === '(sin status)' ? '' : s)}" style="--w:${n ? (m.get(s) || 0) / n * 100 : 0}%"></span></div>`;
  // imputaciones por semana (fecha de status)
  const wk = new Map(); const isoWeek = s => { const t = new Date(s + 'T00:00:00'); if (isNaN(t)) return ''; const y = new Date(t); y.setDate(t.getDate() + 3 - ((t.getDay() + 6) % 7)); const w1 = new Date(y.getFullYear(), 0, 4); return `${y.getFullYear()}-S${String(1 + Math.round(((y - w1) / 864e5 - 3 + ((w1.getDay() + 6) % 7)) / 7)).padStart(2, '0')}`; };
  d.rows.forEach(r => { [[sf, df], [st, dt]].forEach(([a, b]) => { if (a !== undefined && b !== undefined && r[a] === 'IMPUTADO' && r[b]) { const k = isoWeek(r[b]); if (k) wk.set(k, (wk.get(k) || 0) + 1); } }); });
  const weeks = [...wk].sort((a, b) => a[0].localeCompare(b[0])).slice(-12), mx = Math.max(1, ...weeks.map(w => w[1]));
  root.innerHTML = `
    <section class="cx-hero"><div class="cx-ring" style="--p:${pct.toFixed(1)}"><b>${pct.toFixed(0)}<small>%</small></b></div>
      <div><h3>Extremos imputados</h3><p><b>${imp.toLocaleString('es-ES')}</b> de ${ext.toLocaleString('es-ES')} extremos</p><p class="muted">${both.toLocaleString('es-ES')} cables con los dos extremos imputados</p></div></section>
    <div class="kpis"><div class="kpi"><span>Cables</span><b>${n.toLocaleString('es-ES')}</b></div><div class="kpi"><span>Falta</span><b>${falta}</b><small>extremos</small></div><div class="kpi"><span>Pendientes</span><b>${pen}</b><small>extremos</small></div></div>
    ${cxConexBlock(d, n)}
    <p class="chart-t">Estado por extremo</p>
    <div class="cx-tab">${all.map(s => `<button class="cx-line" data-cx-filter="${esc(s)}"><span class="cx-lbl"><i class="cx-dotc ${cxStCls(s === '(sin status)' ? '' : s)}"></i>${esc(s === '(sin status)' ? 'Sin status' : sentence(s))}</span>
      <span class="cx-two"><span class="cx-side"><em>From</em>${bar(A, s)}<b>${A.get(s) || 0}</b></span><span class="cx-side"><em>To</em>${bar(B, s)}<b>${B.get(s) || 0}</b></span></span></button>`).join('')}</div>
    ${weeks.length ? `<p class="chart-t">Imputaciones por semana</p><div class="cx-wk">${weeks.map(([k, v]) => `<div class="cx-col"><b>${v}</b><i style="--h:${v / mx * 100}%"></i><small>${esc(k.slice(5))}</small></div>`).join('')}</div>` : ''}`;
}

function cxRepaint() {
  const m = $('#app').dataset.tab;
  if (m === 'cbuscar') renderCxSearch(); else if (m === 'cresumen') renderCxStats();
  if (CX.sel && $('#view').classList.contains('open') && !(document.activeElement && /INPUT|TEXTAREA/.test(document.activeElement.tagName) && $('#vBody').contains(document.activeElement))) renderCx();
}

/* ---------- eventos ---------- */
document.addEventListener('input', e => {
  if (e.target.id === 'cxQ') { CX.qText = e.target.value; CX.lim = 120; renderCxSearch(); const q = $('#cxQ'); q.focus(); q.setSelectionRange(q.value.length, q.value.length); }
});
document.addEventListener('click', async e => {
  const t = e.target.closest('button'); if (!t) return;
  if (t.id === 'cxPull') { t.disabled = true; await pullCx(false); t.disabled = false; renderCxSearch(); }
  else if (t.dataset.cxOpen !== undefined) openCx(t.dataset.cxOpen);
  else if (t.id === 'cxMore') { CX.lim += 200; renderCxSearch(); }
  else if (t.closest('#cxChips')) { CX.st = t.dataset.st; CX.lim = 120; renderCxSearch(); }
  else if (t.dataset.cxFilter !== undefined) { CX.st = t.dataset.cxFilter; setTab('cbuscar'); }
});
$('#vBody').addEventListener('click', e => {
  const t = e.target.closest('button'); if (!t || !CX.sel) return;
  const tag = CX.sel;
  if (t.id === 'cxCopy') { navigator.clipboard.writeText(tag).then(() => toast('Tag copiado'), () => toast('No se pudo copiar el tag')); }
  else if (t.id === 'cxToCab') { setTab('search'); openCable(IDX.get(norm(tag)), true); }
  else if (t.dataset.cxUndo !== undefined) { if (confirm('¿Deshacer este cambio y devolver el valor anterior?')) cxSave(tag, { [t.dataset.cxUndo]: t.dataset.v }); }
  else if (t.id === 'cxDiscard') { CX.draft = {}; renderCx(); }
  else if (t.id === 'cxSaveBtn') {
    const i = CX.idx.get(norm(tag)), ch = {};
    for (const [k, v] of Object.entries(CX.draft)) if ((CX.data.rows[i][CX.ci.get(k)] || '') !== v) ch[k] = v;
    if (!cxAdm()) for (const k of Object.keys(ch)) if (!ch[k] && (CX.data.rows[i][CX.ci.get(k)] || '')) { delete ch[k]; toast('Solo el administrador puede borrar datos'); }
    if (!Object.keys(ch).length) { CX.draft = {}; return renderCx(); }
    cxSave(tag, ch);
  } else if (t.dataset.cxSet !== undefined) {
    const f = t.parentElement.dataset.f; CX.draft[f] = t.dataset.cxSet;
    const dn = 'FECHA_' + f, dc = CX.data.cols[cxCol(dn)];
    if (dc && dc.edit && CX.draft[dn] === undefined) CX.draft[dn] = t.dataset.cxSet ? cxToday() : '';
    renderCx();
  }
});
$('#vBody').addEventListener('input', e => {
  const f = e.target.dataset && e.target.dataset.f; if (!f || !CX.sel) return;
  CX.draft[f] = e.target.value;
  const b = $('#cxSaveBtn'), n = Object.keys(CX.draft).length; if (b) { b.disabled = !n; b.textContent = `Guardar cambios (${n})`; } const dsc = $('#cxDiscard'); if (dsc) dsc.disabled = !n;
});
loadCx();
