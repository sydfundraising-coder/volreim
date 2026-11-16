// VolReim front end (stage 2): sign-in, profile, claims.
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';

const SUPABASE_URL = 'https://gsbvkcfbppqaakzouals.supabase.co';
const SUPABASE_KEY = 'sb_publishable_I-XWQYPoMMxnHVbxtO93dw_qN1T1IcS'; // public key; access is controlled by RLS
const sb = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: true, detectSessionInUrl: false } });

const app = document.getElementById('app');
const nav = document.getElementById('nav');
let me = null;            // app_users row
let cache = {};           // expense types, locations

// ---------- helpers ----------
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = n => Number(n || 0).toLocaleString('en-AU', { style: 'currency', currency: 'AUD' });
const r2 = n => Math.round(Number(n || 0) * 100) / 100;
function toast(msg, ms = 3500) { const t = document.getElementById('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), ms); }
function fail(e) { console.error(e); toast(e?.message || String(e), 6000); }
const STATUS = { draft: 'Draft', submitted: 'With approver 1', approved_1: 'With approver 2', approved: 'Approved', ap_checked: 'AP checked', sent_to_central: 'Sent to Central AP', rejected: 'Rejected', returned: 'Returned to you', cancelled: 'Cancelled' };
const pill = s => `<span class="pill ${s}">${STATUS[s] || s}</span>`;

// ---------- routing ----------
window.addEventListener('hashchange', route);
document.getElementById('signout').onclick = async () => { await sb.auth.signOut(); me = null; location.hash = '#/signin'; };

async function route() {
  const { data: { session } } = await sb.auth.getSession();
  const h = location.hash || '#/claims';
  if (!session) { nav.hidden = true; return viewSignIn(); }
  if (!me) await loadMe();
  nav.hidden = false;
  nav.querySelectorAll('a').forEach(a => a.classList.toggle('on', h.startsWith(a.getAttribute('href'))));
  try {
    if (h.startsWith('#/profile')) return await viewProfile();
    if (h.startsWith('#/claim/new')) return await viewClaim(null);
    const m = h.match(/^#\/claim\/([0-9a-f-]{36})/); if (m) return await viewClaim(m[1]);
    return await viewClaims();
  } catch (e) { fail(e); }
}

async function loadMe() {
  const { data: { user } } = await sb.auth.getUser();
  const { data, error } = await sb.from('app_users').select('id,email,full_name,mobile,home_location_id').eq('email', user.email).maybeSingle();
  if (error) throw error;
  me = data || { email: user.email };
}

// ---------- sign in (email + 6-digit code) ----------
function viewSignIn() {
  app.innerHTML = `<div class="card" style="max-width:420px;margin:40px auto">
    <h1>Sign in</h1>
    <p class="muted small">Enter the email address registered with your Mandir Centre. We'll email you a 6-digit code.</p>
    <form id="f1"><label for="em">Email</label><input id="em" type="email" autocomplete="email" required>
    <div class="row"><button class="primary" type="submit">Send code</button></div></form>
    <form id="f2" hidden><label for="code">6-digit code</label><input id="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" required>
    <div class="row"><button class="primary" type="submit">Sign in</button><button type="button" class="link" id="back">Use a different email</button></div></form>
    <p id="msg" class="small"></p></div>`;
  const f1 = app.querySelector('#f1'), f2 = app.querySelector('#f2'), msg = app.querySelector('#msg');
  let email = '';
  f1.onsubmit = async ev => {
    ev.preventDefault(); email = app.querySelector('#em').value.trim().toLowerCase(); msg.textContent = 'Sending…'; msg.className = 'small muted';
    const { error } = await sb.auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
    if (error) { msg.textContent = error.message; msg.className = 'small err'; return; }
    f1.hidden = true; f2.hidden = false; msg.textContent = `Code sent to ${email}. Check your inbox (and junk folder).`; app.querySelector('#code').focus();
  };
  app.querySelector('#back').onclick = () => { f2.hidden = true; f1.hidden = false; msg.textContent = ''; };
  f2.onsubmit = async ev => {
    ev.preventDefault();
    const token = app.querySelector('#code').value.trim();
    let { error } = await sb.auth.verifyOtp({ email, token, type: 'email' });
    if (error) { msg.textContent = 'That code did not work. Check it, or request a new one.'; msg.className = 'small err'; return; }
    me = null; location.hash = '#/claims'; route();
  };
}

// ---------- profile ----------
async function viewProfile() {
  const [{ data: bank }, locs] = await Promise.all([
    sb.from('payee_bank').select('*').eq('email', me.email).maybeSingle(),
    myLocations()
  ]);
  const home = locs.find(l => l.id === me.home_location_id);
  app.innerHTML = `<h1>My profile</h1>
  <form id="pf" class="card"><h2>Contact</h2><div class="grid">
    <div><label>Email</label><input value="${esc(me.email)}" disabled></div>
    <div><label for="fn">Full name</label><input id="fn" required value="${esc(me.full_name)}"></div>
    <div><label for="mb">Mobile</label><input id="mb" inputmode="tel" value="${esc(me.mobile)}"></div>
    <div><label>Home Mandir Centre</label><input value="${esc(home?.name || '')}" disabled></div></div>
    <div class="row"><button class="primary">Save contact</button></div></form>
  <form id="bf" class="card"><h2>Bank details for reimbursements</h2>
    <p class="muted small">Only you and Central Accounts Payable can see these. Reimbursements are paid into this account.</p>
    <div class="grid">
    <div><label for="an">Account name</label><input id="an" required value="${esc(bank?.account_name)}"></div>
    <div><label for="bsb">BSB</label><input id="bsb" required inputmode="numeric" pattern="[0-9]{3}-?[0-9]{3}" placeholder="062-000" value="${esc(bank?.bsb)}"></div>
    <div><label for="acc">Account number</label><input id="acc" required inputmode="numeric" pattern="[0-9]{5,10}" value="${esc(bank?.account_no)}"></div></div>
    <div class="row"><button class="primary">Save bank details</button>${bank ? `<span class="muted small">Last updated ${new Date(bank.updated_at).toLocaleString('en-AU')}</span>` : ''}</div></form>
  <div class="card"><h2>Mandir Centres you can submit for</h2><p>${locs.map(l => esc(l.name)).join(', ') || '<span class="muted">None</span>'}</p>
  <p class="muted small">To submit for another centre, ask that centre's accounts team to grant you access.</p></div>`;
  app.querySelector('#pf').onsubmit = async ev => {
    ev.preventDefault();
    const { error } = await sb.from('app_users').update({ full_name: app.querySelector('#fn').value.trim(), mobile: app.querySelector('#mb').value.trim() }).eq('email', me.email);
    if (error) return fail(error); await loadMe(); toast('Contact details saved');
  };
  app.querySelector('#bf').onsubmit = async ev => {
    ev.preventDefault();
    const row = { email: me.email, account_name: app.querySelector('#an').value.trim(), bsb: app.querySelector('#bsb').value.trim(), account_no: app.querySelector('#acc').value.trim(), updated_at: new Date().toISOString() };
    const { error } = await sb.from('payee_bank').upsert(row);
    if (error) return fail(error); toast('Bank details saved'); viewProfile();
  };
}

// ---------- lookups ----------
async function myLocations() {
  if (cache.locs) return cache.locs;
  const { data: ids, error } = await sb.rpc('my_submit_locations'); if (error) throw error;
  const list = (ids || []).map(x => typeof x === 'string' ? x : x.my_submit_locations);
  if (!list.length) return (cache.locs = []);
  const { data, error: e2 } = await sb.from('locations').select('id,name,parent_id,loc_type,entity_code').in('id', list).order('name');
  if (e2) throw e2; return (cache.locs = data);
}
async function expenseTypes() {
  if (cache.et) return cache.et;
  const { data, error } = await sb.from('expense_types').select('code,label,gl_account,volunteer_visible,hint').eq('is_active', true).order('label');
  if (error) throw error; return (cache.et = data);
}
async function purposesFor(loc) {
  const ids = [loc.id]; if (loc.parent_id) ids.push(loc.parent_id);
  const { data, error } = await sb.from('v_purposes').select('id,name,location_id,subaccount_display,default_expense_type,gl_mode,approver1_email,approver2_email,allow_reimbursement,allow_supplier_invoice').in('location_id', ids).eq('is_active', true).order('name');
  if (error) throw error; return data;
}

// ---------- claims list ----------
async function viewClaims() {
  const { data, error } = await sb.from('claims').select('id,ref,request_type,status,total_inc,created_at,submitted_at,description,locations(name),purposes(name)').order('created_at', { ascending: false });
  if (error) throw error;
  app.innerHTML = `<h1>My claims</h1>
  <div class="row" style="margin-top:0;margin-bottom:12px"><a href="#/claim/new"><button class="primary">New claim</button></a></div>
  <div class="card tablewrap">${data.length ? `<table><thead><tr><th>Ref</th><th>Centre / Purpose</th><th>Type</th><th class="num">Total</th><th>Status</th><th>Date</th></tr></thead><tbody>
  ${data.map(c => `<tr class="clickrow" data-id="${c.id}"><td>${esc(c.ref)}</td><td>${esc(c.locations?.name)}<br><span class="muted small">${esc(c.purposes?.name)}</span></td>
  <td>${c.request_type === 'supplier_invoice' ? 'Supplier invoice' : 'Reimbursement'}</td><td class="num">${money(c.total_inc)}</td><td>${pill(c.status)}</td>
  <td class="small">${new Date(c.submitted_at || c.created_at).toLocaleDateString('en-AU')}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">No claims yet.</p>'}</div>`;
  app.querySelectorAll('.clickrow').forEach(tr => tr.onclick = () => location.hash = '#/claim/' + tr.dataset.id);
}

// ---------- claim editor ----------
async function viewClaim(id) {
  const [locs, ets] = await Promise.all([myLocations(), expenseTypes()]);
  let claim = { request_type: 'reimbursement', status: 'draft', location_id: me.home_location_id }, lines = [], files = [];
  if (id) {
    const { data, error } = await sb.from('claims').select('*').eq('id', id).single(); if (error) throw error; claim = data;
    lines = (await sb.from('claim_lines').select('*').eq('claim_id', id).order('line_no')).data || [];
    files = (await sb.from('claim_files').select('*').eq('claim_id', id).order('uploaded_at')).data || [];
  }
  if (!lines.length) lines = [{ receipt_date: new Date().toISOString().slice(0, 10), description: '', amount_inc: '', gst: 0 }];
  const editable = ['draft', 'returned'].includes(claim.status);
  if (!locs.length) { app.innerHTML = `<div class="card"><p>Your email is not linked to a Mandir Centre yet. Please contact your Mandir Centre accounts team.</p></div>`; return; }
  if (!locs.some(l => l.id === claim.location_id)) claim.location_id = locs[0].id;

  app.innerHTML = `<h1>${id ? esc(claim.ref) : 'New claim'} ${pill(claim.status)}</h1>
  <fieldset ${editable ? '' : 'disabled'} style="border:0;padding:0;margin:0">
  <div class="card"><h2>About this claim</h2><div class="grid">
    <div><label for="rt">Type</label><select id="rt"><option value="reimbursement">Reimbursement to me</option><option value="supplier_invoice">Supplier invoice (pay supplier)</option></select></div>
    <div><label for="loc">Mandir Centre</label><select id="loc">${locs.map(l => `<option value="${l.id}">${esc(l.name)}</option>`).join('')}</select></div>
    <div><label for="pur">Purpose</label><select id="pur"></select></div></div>
    <div id="pinfo" class="info"></div>
    <label for="desc">What was this for?</label><textarea id="desc" placeholder="e.g. Groceries for Sunday sabha prasad">${esc(claim.description)}</textarea>
    <div id="supp" class="grid" hidden>
      <div><label for="sn">Supplier name</label><input id="sn" value="${esc(claim.supplier_name)}"></div>
      <div><label for="sabn">Supplier ABN</label><input id="sabn" value="${esc(claim.supplier_abn)}"></div>
      <div><label for="sinv">Invoice number</label><input id="sinv" value="${esc(claim.supplier_invoice_no)}"></div>
      <div><label for="sbsb">Supplier BSB (if on invoice)</label><input id="sbsb" value="${esc(claim.supplier_bsb)}"></div>
      <div><label for="sacc">Supplier account no.</label><input id="sacc" value="${esc(claim.supplier_account_no)}"></div></div>
  </div>
  <div class="card"><h2>Receipt lines</h2><div class="tablewrap"><table class="lines"><thead><tr><th>Date</th><th>Description</th><th>Expense type</th><th class="num">Amount inc GST</th><th class="num">GST</th><th>Tax</th><th></th></tr></thead><tbody id="lb"></tbody>
  <tfoot><tr><td colspan="3"><strong>Total</strong></td><td class="num" id="tot"></td><td class="num" id="totg"></td><td colspan="2"></td></tr></tfoot></table></div>
  <div class="row"><button type="button" id="addl">Add line</button></div>
  <p class="muted small">Enter GST only if the receipt shows GST. Use "÷11" to fill GST for a fully taxable receipt. No GST means tax code FRE.</p></div>
  <div class="card"><h2>Receipts and invoices</h2>
    <ul id="fl">${files.map(f => `<li><a href="#" data-path="${esc(f.storage_path)}" class="dl">${esc(f.file_name)}</a> ${editable ? `<button type="button" class="link rmf" data-id="${f.id}" data-path="${esc(f.storage_path)}">remove</button>` : ''}</li>`).join('') || '<li class="muted">None attached yet</li>'}</ul>
    ${editable ? `<label for="fu">Add files (PDF or photo, up to 10 MB each)</label><input id="fu" type="file" multiple accept="application/pdf,image/*">` : ''}</div>
  </fieldset>
  <div class="row">${editable ? `<button class="primary" id="save">Save draft</button><button class="primary" id="submit">Submit for approval</button>${id && claim.status === 'draft' ? '<button id="del">Delete draft</button>' : ''}` : ''}<a href="#/claims"><button type="button">Back to my claims</button></a></div>
  <p id="cmsg" class="small"></p>`;

  const $ = s => app.querySelector(s);
  $('#rt').value = claim.request_type; $('#loc').value = claim.location_id;
  let purposes = [];
  const etOptions = (sel, purpose) => {
    const list = ets.filter(e => e.volunteer_visible || e.code === sel || e.code === purpose?.default_expense_type);
    return list.map(e => `<option value="${e.code}" ${e.code === sel ? 'selected' : ''}>${esc(e.label)} (${e.gl_account})</option>`).join('');
  };
  const curPurpose = () => purposes.find(p => p.id === $('#pur').value);

  async function loadPurposes(keep) {
    const loc = locs.find(l => l.id === $('#loc').value);
    purposes = (await purposesFor(loc)).filter(p => $('#rt').value === 'supplier_invoice' ? p.allow_supplier_invoice : p.allow_reimbursement);
    $('#pur').innerHTML = '<option value="">Choose a Purpose…</option>' + purposes.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('');
    if (keep && purposes.some(p => p.id === keep)) $('#pur').value = keep;
    showPurpose();
  }
  function showPurpose() {
    const p = curPurpose();
    $('#supp').hidden = $('#rt').value !== 'supplier_invoice';
    if (!p) { $('#pinfo').innerHTML = 'Pick the Purpose that best matches the spend. It decides who approves the claim.'; drawLines(); return; }
    const et = ets.find(e => e.code === p.default_expense_type);
    $('#pinfo').innerHTML = `Subaccount <strong>${esc(p.subaccount_display || '—')}</strong> · Approvers: ${esc(p.approver1_email)} then ${esc(p.approver2_email)}<br>` +
      (p.gl_mode === 'Fixed' ? `Expense type is fixed: <strong>${esc(et?.label || p.default_expense_type)}</strong>` : `Default expense type: ${esc(et?.label || '—')} (you can change it per line)`);
    drawLines();
  }
  function readLines() {
    return [...$('#lb').querySelectorAll('tr')].map(tr => ({
      receipt_date: tr.querySelector('.d').value, description: tr.querySelector('.ds').value.trim(),
      expense_type: tr.querySelector('.et').value, amount_inc: tr.querySelector('.a').value, gst: tr.querySelector('.g').value || 0
    }));
  }
  function drawLines(current) {
    const p = curPurpose(); const ls = current || (drawLines._init ? readLines() : lines); drawLines._init = true;
    $('#lb').innerHTML = ls.map(l => {
      const et = p?.gl_mode === 'Fixed' ? p.default_expense_type : (l.expense_type || p?.default_expense_type || '');
      return `<tr><td><input class="d" type="date" value="${esc(l.receipt_date)}"></td>
      <td class="wide"><input class="ds" value="${esc(l.description)}" placeholder="Item / shop"></td>
      <td class="wide"><select class="et" ${p?.gl_mode === 'Fixed' ? 'disabled' : ''}>${etOptions(et, p)}</select></td>
      <td class="num"><input class="a" type="number" step="0.01" min="0" value="${esc(l.amount_inc)}" style="text-align:right"></td>
      <td class="num"><input class="g" type="number" step="0.01" min="0" value="${esc(l.gst)}" style="text-align:right;width:90px"> <button type="button" class="link g11">÷11</button></td>
      <td class="tx small">${Number(l.gst) > 0 ? 'GST' : 'FRE'}</td><td><button type="button" class="link rml">remove</button></td></tr>`;
    }).join('');
    $('#lb').querySelectorAll('tr').forEach(tr => {
      tr.querySelector('.g11').onclick = () => { tr.querySelector('.g').value = r2(Number(tr.querySelector('.a').value) / 11).toFixed(2); totals(); };
      tr.querySelector('.rml').onclick = () => { if ($('#lb').children.length > 1) { tr.remove(); totals(); } };
      tr.querySelectorAll('input').forEach(i => i.oninput = totals);
    });
    totals();
  }
  function totals() {
    let t = 0, g = 0;
    $('#lb').querySelectorAll('tr').forEach(tr => { const a = Number(tr.querySelector('.a').value || 0), gs = Number(tr.querySelector('.g').value || 0); t += a; g += gs; tr.querySelector('.tx').textContent = gs > 0 ? 'GST' : 'FRE'; });
    $('#tot').textContent = money(t); $('#totg').textContent = money(g);
  }
  $('#rt').onchange = () => loadPurposes($('#pur').value);
  $('#loc').onchange = () => loadPurposes();
  $('#pur').onchange = showPurpose;
  $('#addl').onclick = () => { const ls = readLines(); ls.push({ receipt_date: new Date().toISOString().slice(0, 10), description: '', amount_inc: '', gst: 0 }); drawLines(ls); };
  await loadPurposes(claim.purpose_id);

  app.querySelectorAll('.dl').forEach(a => a.onclick = async ev => {
    ev.preventDefault(); const { data, error } = await sb.storage.from('receipts').createSignedUrl(a.dataset.path, 120);
    if (error) return fail(error); window.open(data.signedUrl, '_blank');
  });
  if (!editable) return;

  async function save() {
    const p = curPurpose(); if (!p) throw new Error('Choose a Purpose');
    const ls = readLines().filter(l => l.description || l.amount_inc);
    for (const [i, l] of ls.entries()) {
      if (!l.receipt_date || !l.description || !(Number(l.amount_inc) > 0)) throw new Error(`Line ${i + 1}: date, description and amount are required`);
      if (Number(l.gst) > r2(Number(l.amount_inc) / 11) + 0.01) throw new Error(`Line ${i + 1}: GST cannot be more than 1/11 of the amount`);
    }
    const hdr = {
      request_type: $('#rt').value, location_id: $('#loc').value, purpose_id: p.id, description: $('#desc').value.trim() || null,
      supplier_name: $('#sn').value.trim() || null, supplier_abn: $('#sabn').value.trim() || null, supplier_invoice_no: $('#sinv').value.trim() || null,
      supplier_bsb: $('#sbsb').value.trim() || null, supplier_account_no: $('#sacc').value.trim() || null
    };
    if (!id) {
      const { data, error } = await sb.from('claims').insert(hdr).select('id').single(); if (error) throw error; id = data.id;
    } else {
      const { error } = await sb.from('claims').update(hdr).eq('id', id); if (error) throw error;
      const { error: e2 } = await sb.from('claim_lines').delete().eq('claim_id', id); if (e2) throw e2;
    }
    if (ls.length) {
      const rows = ls.map((l, i) => ({ claim_id: id, line_no: i + 1, receipt_date: l.receipt_date, description: l.description, expense_type: l.expense_type || p.default_expense_type, gl_account: '-', amount_inc: r2(l.amount_inc), gst: r2(l.gst) }));
      const { error } = await sb.from('claim_lines').insert(rows); if (error) throw error;
    }
    const fu = $('#fu');
    for (const f of fu?.files || []) {
      if (f.size > 10485760) throw new Error(`${f.name} is larger than 10 MB`);
      const path = `${id}/${Date.now()}-${f.name.replace(/[^\w.\-]+/g, '_')}`;
      const { error } = await sb.storage.from('receipts').upload(path, f, { contentType: f.type });
      if (error) throw error;
      const { error: e3 } = await sb.from('claim_files').insert({ claim_id: id, storage_path: path, file_name: f.name, size_bytes: f.size });
      if (e3) throw e3;
    }
    return id;
  }
  const busy = b => app.querySelectorAll('button').forEach(x => x.disabled = b);
  $('#save').onclick = async () => { busy(true); try { await save(); toast('Draft saved'); location.hash = '#/claim/' + id; await viewClaim(id); } catch (e) { fail(e); } finally { busy(false); } };
  $('#submit').onclick = async () => {
    busy(true);
    try {
      await save();
      const { data: ref, error } = await sb.rpc('submit_claim', { p_claim: id }); if (error) throw error;
      toast(`${ref} submitted for approval`); location.hash = '#/claims';
    } catch (e) { fail(e); if (id) location.hash = '#/claim/' + id; } finally { busy(false); }
  };
  if ($('#del')) $('#del').onclick = async () => {
    if (!window.confirm('Delete this draft?')) return;
    for (const f of files) await sb.storage.from('receipts').remove([f.storage_path]);
    const { error } = await sb.from('claims').delete().eq('id', id); if (error) return fail(error);
    toast('Draft deleted'); location.hash = '#/claims';
  };
  app.querySelectorAll('.rmf').forEach(b => b.onclick = async () => {
    await sb.storage.from('receipts').remove([b.dataset.path]);
    const { error } = await sb.from('claim_files').delete().eq('id', b.dataset.id); if (error) return fail(error);
    viewClaim(id);
  });
}

route();
