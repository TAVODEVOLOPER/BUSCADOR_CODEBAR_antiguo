/* Conexionado: lista de trabajo. Se arma desde Buscar (cables de tu hoja con 0 %, 50 % o 100 % de avance y cables nuevos del CC_SCHEDULE)
   y se manda a una pestaña del Sheet, a Excel o a un PDF de trabajo, igual que la lista de Cableado. */
'use strict';
CX.list = LS.get('cxList', []);
const cxListSave = () => { LS.set('cxList', CX.list); cxListPaint(); if (typeof cxAddBtn === 'function') cxAddBtn(); };
const cxListSheet = () => LS.get('cxSheetName', 'LISTA_CONEXIONADO') || 'LISTA_CONEXIONADO';
const cxIsNew = tag => !CX.data || !CX.idx.has(norm(tag));

function cxListAdd(tags) {
  const have = new Set(CX.list.map(x => norm(x.tag))); let add = 0;
  for (const tag of tags) { const k = norm(tag); if (have.has(k)) continue; have.add(k); CX.list.push({ tag, nuevo: cxIsNew(tag), time: new Date().toISOString() }); add++; }
  cxListSave(); return add;
}
function cxListToggle(tag, add) {
  const k = norm(tag), i = CX.list.findIndex(x => norm(x.tag) === k);
  if (i >= 0) { CX.list.splice(i, 1); cxListSave(); toast('Quitado de la lista'); }
  else { cxListAdd([tag]); toast('Añadido a la lista'); }
}
function cxAddAllHits() {
  let tags;
  if (CX.src === 'new') { const hits = cxNewHits() || []; tags = hits.map(ri => CCD.src.rows[ri][CCD.src.tagi]); }
  else tags = cxHits().map(i => CX.data.rows[i][CX.ti]);
  if (tags.length > 400 && !confirm(`Se van a añadir ${tags.length.toLocaleString('es-ES')} cables a la lista. ¿Seguro?`)) return;
  const n = cxListAdd(tags); toast(n ? `Añadidos ${n} a la lista` : 'Todos esos cables ya estaban en la lista');
  renderCxSearch();
}

/* valor de una columna de la hoja CONEXIONADO para un cable de la lista; si es nuevo, de las columnas del CC_SCHEDULE con el mismo nombre */
function cxItemAv(x) { const i = CX.data && CX.idx.get(norm(x.tag)); return i === undefined || i === null ? 0 : cxAv(CX.data.rows[i]); }
function cxItemVal(x, name) {
  if (name === 'Avance') return cxItemAv(x) + ' %';
  if (name === 'Origen') return cxIsNew(x.tag) ? 'Nuevo del CC_SCHEDULE' : 'CONEXIONADO';
  const i = CX.data ? CX.idx.get(norm(x.tag)) : undefined;
  if (i !== undefined) { const ci = CX.ci.get(name); return ci === undefined ? '' : (CX.data.rows[i][ci] ?? ''); }
  if (typeof CCD !== 'undefined' && CCD.src) {
    const ri = CCD.idx.get(norm(x.tag)); if (ri === undefined) return '';
    const ci = CCD.src.columns.findIndex(c => nname(c.name) === nname(name));
    return ci < 0 ? '' : (CCD.src.rows[ri][ci] ?? '');
  }
  return '';
}
const cxNice = v => (typeof fmtVal === 'function' ? fmtVal(String(v ?? '')) : String(v ?? ''));
function cxListMatrix() {
  const cols = CX.data ? CX.data.cols.map(c => c.name).filter(n => n !== 'CABLE_NUMBER') : [];
  const head = ['#', 'Hora', 'CABLE_NUMBER', 'Origen', 'Avance', ...cols];
  return { head, rows: CX.list.map((x, n) => [n + 1, new Date(x.time).toLocaleString('es-ES'), x.tag, cxItemVal(x, 'Origen'), cxItemVal(x, 'Avance'), ...cols.map(c => cxNice(cxItemVal(x, c)))]) };
}

function cxListPaint() {
  $$('.cxcount').forEach(c => { c.textContent = CX.list.length; });
  const t = $('#cxListTable'); if (!t) return;
  const nn = CX.list.filter(x => cxIsNew(x.tag)).length;
  $('#cxListHint').textContent = CX.list.length
    ? `${CX.list.length.toLocaleString('es-ES')} ${CX.list.length === 1 ? 'cable' : 'cables'}${nn ? `, ${nn} nuevos del CC_SCHEDULE` : ''}. Los nuevos llevan los datos que tienen en el CC_SCHEDULE.`
    : 'La lista está vacía. En Buscar elige cables con 0 % o 50 % de avance, o cables nuevos del CC_SCHEDULE, y pulsa Añadir.';
  const sh = x => String(x ?? '').replace(/^#HKF\./, '');
  t.innerHTML = '<thead><tr><th>#</th><th>Cable</th><th>From</th><th>Status From</th><th>To</th><th>Status To</th><th>Avance</th><th>Origen</th><th></th></tr></thead><tbody>' +
    CX.list.map((x, n) => `<tr data-n="${n}" class="${cxIsNew(x.tag) ? '' : ''}"><td>${n + 1}</td><td class="tagc">${esc(x.tag)}</td><td>${esc(sh(cxItemVal(x, 'From_Tag')))}</td><td>${esc(cxNice(cxItemVal(x, 'STATUS_FROM')))}</td><td>${esc(sh(cxItemVal(x, 'To_Tag')))}</td><td>${esc(cxNice(cxItemVal(x, 'STATUS_TO')))}</td><td>${cxItemAv(x)} %</td><td>${cxIsNew(x.tag) ? 'Nuevo' : 'Hoja'}</td><td><button class="x" data-del="${n}" aria-label="Quitar de la lista">✕</button></td></tr>`).join('') + '</tbody>';
}
const cxNeedList = () => CX.list.length ? true : (toast('La lista está vacía. Añade cables desde Buscar.'), false);
const cxStamp = () => new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');

document.addEventListener('click', async e => {
  const t = e.target.closest('button,tr'); if (!t) return;
  if (t.closest('#cxListTable')) {
    const dl = e.target.closest('[data-del]');
    if (dl) { CX.list.splice(+dl.dataset.del, 1); cxListSave(); return; }
    const tr = e.target.closest('tr[data-n]');
    if (tr) { const x = CX.list[+tr.dataset.n]; if (x && cxHas(x.tag)) openCx(x.tag); else toast('Es un cable nuevo: todavía no tiene fila en CONEXIONADO'); }
    return;
  }
  if (t.id === 'cxBtnXlsx') {
    if (!cxNeedList()) return;
    const { head, rows } = cxListMatrix(), ws = XLSX.utils.aoa_to_sheet([head, ...rows]);
    ws['!cols'] = head.map(h => ({ wch: Math.min(38, Math.max(10, String(h).length + 2)) }));
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'LISTA_CONEXIONADO'); XLSX.writeFile(wb, `lista_conexionado_${cxStamp()}.xlsx`);
  } else if (t.id === 'cxBtnSheet') {
    if (!cxNeedList()) return;
    if (!cloud.on()) { toast('Conecta tu Google (URL y clave) en Ajustes', 4000); return; }
    const { head, rows } = cxListMatrix();
    try { const j = await apiPost('scans', { sheet: cxListSheet(), header: head, rows }); toast(`Enviadas ${j.added} filas a la pestaña ${cxListSheet()}`, 3500); }
    catch (er) { toast('No se pudo enviar la lista: ' + er.message, 4500); }
  } else if (t.id === 'cxBtnPdf') {
    if (!cxNeedList()) return;
    if (typeof openPdf === 'function') { pdfMode = 'con'; openPdf(); }
  } else if (t.id === 'cxBtnClear') {
    if (!CX.list.length) return;
    if (!confirm(cloud.on() ? `¿Vaciar la lista de conexionado? También se borran las filas de la pestaña ${cxListSheet()} de tu Google Sheet.` : '¿Vaciar la lista de conexionado?')) return;
    if (cloud.on() && !(await cloudDelete('clearScans', { sheet: cxListSheet() }))) return;
    CX.list = []; cxListSave(); toast('Lista vaciada');
  }
});
/* "Añadir a la lista" de la ficha */
$('#vAddList').addEventListener('click', () => {
  if ($('#app').dataset.mod !== 'con' || !CX.sel) return;
  if (cxInList(CX.sel)) return toast('Ese cable ya está en la lista');
  cxListAdd([CX.sel]); toast('Añadido a la lista'); renderCxSearch();
});
cxListPaint();
