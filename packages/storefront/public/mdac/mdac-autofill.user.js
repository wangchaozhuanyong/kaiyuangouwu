// ==UserScript==
// @name         MDAC Autofill (Storefront adapter)
// @namespace    https://github.com/nilbloom/mdac
// @version      1.0.2
// @description  Auto-fill the Malaysia Digital Arrival Card (MDAC) form with your own pre-saved traveler info. Config is stored locally via Tampermonkey storage.
// @author       nilbloom
// @homepageURL  https://github.com/nilbloom/mdac
// @supportURL   https://github.com/nilbloom/mdac/issues
// @updateURL    none
// @match        https://imigresen-online.imi.gov.my/mdac/register*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  // ============================================================
  // Config storage key. Config is loaded from Tampermonkey
  // storage (GM_getValue). Open the panel and click "Edit Config"
  // to paste your JSON. See config.example.json in the repo.
  // ============================================================
  const STORAGE_KEY = 'mdac_config';
  const DEFAULT_CONFIG = null; // open-source build ships with no personal data

  let currentIdx = 0;
  let config = null;

  // ============================================================
  // Config load / normalize
  // ============================================================
  function loadConfig() {
    try {
      const raw = GM_getValue(STORAGE_KEY, null);
      if (raw) return typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch (e) {
      console.warn('MDAC: failed to parse stored config', e);
    }
    return DEFAULT_CONFIG;
  }

  function saveConfig(obj) {
    GM_setValue(STORAGE_KEY, JSON.stringify(obj));
  }

  function clearConfig() {
    GM_deleteValue(STORAGE_KEY);
  }

  // Format a Date as DD/MM/YYYY
  function formatDDMMYYYY(d) {
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    return `${dd}/${mm}/${d.getFullYear()}`;
  }

  function tomorrowDDMMYYYY() {
    const t = new Date();
    t.setDate(t.getDate() + 1);
    return formatDDMMYYYY(t);
  }

  // Flatten nested {accommodation:{...}} into the flat field names
  // the form-filling code expects.
  function normalizeShared(shared) {
    if (!shared) shared = {};
    const a = shared.accommodation || {};
    const defaultDate = tomorrowDDMMYYYY();
    return {
      arrDt: shared.arrDt || defaultDate,
      depDt: shared.depDt || defaultDate,
      trvlMode: shared.trvlMode,
      embark: shared.embark,
      vesselNm: shared.vesselNm,
      email: shared.email,
      region: shared.region,
      mobile: shared.mobile,
      accommodationStay: a.stay,
      accommodationAddress1: a.address1,
      accommodationAddress2: a.address2,
      accommodationState: a.state,
      accommodationPostcode: a.postcode,
      accommodationCity: a.city,
    };
  }

  function getTravelers() {
    return (config && Array.isArray(config.travelers)) ? config.travelers : [];
  }

  // ============================================================
  // Form-fill primitives
  // ============================================================
  function setInput(id, value) {
    const el = document.getElementById(id) || document.querySelector(`[name="${id}"]`);
    if (!el || value == null || value === '') return false;
    const proto = el instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
    const desc = Object.getOwnPropertyDescriptor(proto, 'value');
    if (desc && desc.set) desc.set.call(el, value);
    else el.value = value;
    el.dispatchEvent(new Event('focus', { bubbles: true }));
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new Event('blur', { bubbles: true }));
    return true;
  }

  // jQuery UI Datepicker. Date string format: DD/MM/YYYY.
  // The site's onClose handler clears the input if it doesn't think a
  // date was selected via the UI, so we (1) sync the picker's internal
  // state with setDate, (2) hide it, (3) re-assert the value via the
  // native setter AFTER hide, so onClose can't wipe it.
  function setDatepicker(id, ddmmyyyy) {
    const el = document.getElementById(id);
    if (!el || !ddmmyyyy) return false;
    const parts = ddmmyyyy.split('/');
    if (parts.length !== 3) return false;
    const day = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10) - 1;
    const year = parseInt(parts[2], 10);
    const dateObj = new Date(year, month, day);

    try {
      const $ = window.jQuery;
      if ($ && $.fn.datepicker && $(el).hasClass && $(el).hasClass('hasDatepicker')) {
        $(el).datepicker('setDate', dateObj);
        $(el).datepicker('hide');
      }
    } catch (e) {
      console.warn('MDAC: datepicker setDate failed for', id, e);
    }

    // Re-assert value via native setter so any onClose handler that
    // ran during hide() can't leave the field blank.
    const desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
    if (desc && desc.set) desc.set.call(el, ddmmyyyy);
    else el.value = ddmmyyyy;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new Event('blur', { bubbles: true }));
    return true;
  }

  function setSelect(id, value) {
    const el = document.getElementById(id) || document.querySelector(`select[name="${id}"]`);
    if (!el || value == null || value === '') return false;
    const opt = Array.from(el.options).find(o => o.value === value);
    if (opt) {
      el.value = value;
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }
    const fuzzy = Array.from(el.options).find(
      o => o.value.includes(value) || o.text.toUpperCase().includes(String(value).toUpperCase())
    );
    if (fuzzy) {
      el.value = fuzzy.value;
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }
    return false;
  }

  function setHidden(id, value) {
    const el = document.getElementById(id) || document.querySelector(`input[name="${id}"]`);
    if (el && value) { el.value = value; return true; }
    return false;
  }

  // ============================================================
  // Fill form for one traveler
  // ============================================================
  let fillRevision = 0;

  function fillAccommodationCity(d, revision, previousCityOption) {
    let attempts = 0;
    const poll = () => {
      if (revision !== fillRevision) return;
      if (attempts++ >= 40) {
        msg('warn', 'Check the accommodation city and postcode on the official form.');
        return;
      }
      const state = document.getElementById('accommodationState');
      const city = document.getElementById('accommodationCity');
      const expected = String(d.accommodationCity).trim().toUpperCase();
      const options = Array.from(city?.options ?? []).filter(option => option.value);
      const exact = options.find(option => option.value === expected || option.text.trim().toUpperCase() === expected);
      const partial = options.filter(option => option.text.toUpperCase().includes(expected));
      const match = exact || (partial.length === 1 ? partial[0] : undefined);
      if (state?.value !== d.accommodationState || (previousCityOption && previousCityOption === city?.options[0]) || !match) {
        setTimeout(poll, 150);
        return;
      }
      setSelect('accommodationCity', match.value);
      setHidden('sCity', match.value);
      if (d.accommodationPostcode) setInput('accommodationPostcode', d.accommodationPostcode);
    };
    if (d.accommodationCity && d.accommodationState) setTimeout(poll, 150);
    else if (d.accommodationPostcode) setInput('accommodationPostcode', d.accommodationPostcode);
  }

  function preservePhoneRegion(value, revision) {
    const region = document.getElementById('region');
    if (!region || !value) return 0;
    const restore = () => {
      if (revision !== fillRevision || !setSelect('region', value)) return 0;
      setHidden('sRegion', value);
      return 1;
    };
    const observer = new MutationObserver(restore);
    observer.observe(region, { childList: true, subtree: true });
    const stop = event => { if (event.isTrusted) observer.disconnect(); };
    region.addEventListener('change', stop);
    setTimeout(() => {
      observer.disconnect();
      region.removeEventListener('change', stop);
    }, 6000);
    return restore();
  }

  function fillForm(traveler) {
    if (!config) { msg('warn', '⚠️ No config — click ⚙️ Edit Config first'); return 0; }
    const d = { ...normalizeShared(config.shared), ...traveler };
    const revision = ++fillRevision;
    let count = 0;

    if (setInput('name', d.name)) count++;
    if (setInput('passNo', d.passNo)) count++;
    if (setDatepicker('dob', d.dob)) count++;
    if (setDatepicker('passExpDte', d.passExpDte)) count++;
    if (setInput('email', d.email)) count++;
    if (setInput('confirmEmail', d.email)) count++;
    if (setInput('mobile', d.mobile)) count++;

    if (setSelect('nationality', d.nationality)) count++;
    if (setSelect('pob', d.pob)) count++;
    if (setSelect('sex', d.sex)) count++;
    count += preservePhoneRegion(d.region, revision);

    if (setDatepicker('arrDt', d.arrDt)) count++;
    if (setDatepicker('depDt', d.depDt)) count++;
    if (setInput('vesselNm', d.vesselNm)) count++;
    if (setSelect('trvlMode', d.trvlMode)) count++;
    if (setSelect('embark', d.embark)) count++;

    if (setSelect('accommodationStay', d.accommodationStay)) count++;
    if (d.accommodationAddress1 && setInput('accommodationAddress1', d.accommodationAddress1)) count++;
    if (d.accommodationAddress2 && setInput('accommodationAddress2', d.accommodationAddress2)) count++;
    const state = document.getElementById('accommodationState');
    const city = document.getElementById('accommodationCity');
    const stateChanged = state?.value !== d.accommodationState;
    const previousCityOption = stateChanged ? city?.options[0] : undefined;
    if (d.accommodationState && (stateChanged
      ? setSelect('accommodationState', d.accommodationState)
      : state)) count++;
    fillAccommodationCity(d, revision, previousCityOption);

    setHidden('sNation', d.nationality);
    setHidden('sMode', d.trvlMode);
    setHidden('sEmbark', d.embark);
    setHidden('sState', d.accommodationState);
    setHidden('sStay', d.accommodationStay);

    return count;
  }

  // ============================================================
  // Paste-restriction bypass (the site disables paste on inputs)
  // ============================================================
  function enablePaste() {
    document.querySelectorAll('input, textarea, select').forEach(el => {
      el.onpaste = null; el.oncopy = null; el.oncut = null;
      el.removeAttribute('onpaste');
      el.removeAttribute('oncopy');
      el.removeAttribute('oncut');
    });
    ['paste', 'copy', 'cut'].forEach(evt => {
      document.addEventListener(evt, e => e.stopImmediatePropagation(), true);
    });
    const origAdd = EventTarget.prototype.addEventListener;
    EventTarget.prototype.addEventListener = function (type, fn, opts) {
      if (['paste', 'copy', 'cut'].includes(type)) return;
      return origAdd.call(this, type, fn, opts);
    };
  }

  // ============================================================
  // UI
  // ============================================================
  function injectUI() {
    const style = document.createElement('style');
    style.textContent = `
      #mdac-panel {
        position: fixed; top: 12px; right: 12px; z-index: 999999;
        background: #1a1a2e; color: #eee; border-radius: 12px;
        padding: 16px; box-shadow: 0 8px 32px rgba(0,0,0,0.35);
        font-family: -apple-system, BlinkMacSystemFont, 'PingFang SC', sans-serif;
        font-size: 14px; min-width: 280px;
      }
      #mdac-panel.collapsed { min-width: auto; padding: 8px 14px; }
      #mdac-panel.collapsed .mdac-body { display: none; }
      .mdac-header {
        display: flex; justify-content: space-between; align-items: center;
        margin-bottom: 12px; cursor: pointer;
      }
      #mdac-panel.collapsed .mdac-header { margin-bottom: 0; }
      .mdac-title { font-weight: 700; font-size: 15px; }
      #mdac-panel select {
        width: 100%; padding: 8px 12px; border-radius: 8px;
        border: 1px solid #333; background: #16213e; color: #eee;
        font-size: 14px; margin-bottom: 10px; cursor: pointer;
      }
      #mdac-panel button {
        width: 100%; padding: 10px; border: none; border-radius: 8px;
        font-size: 14px; font-weight: 600; cursor: pointer; margin-bottom: 6px;
      }
      .btn-fill { background: #4CAF50; color: #fff; }
      .btn-fill:hover { background: #45a049; }
      .btn-paste { background: #2196F3; color: #fff; }
      .btn-paste:hover { background: #1e88e5; }
      .btn-cfg { background: #7e57c2; color: #fff; }
      .btn-cfg:hover { background: #6a47b0; }
      .btn-clear { background: #555; color: #ccc; font-size: 12px !important; }
      .btn-clear:hover { background: #666; }
      .mdac-row { display: flex; gap: 6px; }
      .mdac-row button { flex: 1; }
      .mdac-hr { border-top: 1px solid #333; margin: 8px 0; }
      .mdac-hint { font-size: 11px; color: #888; text-align: center; margin-top: 6px; }
      #mdac-msg {
        margin-top: 8px; padding: 8px; border-radius: 6px;
        font-size: 12px; text-align: center; display: none;
      }
      #mdac-msg.ok  { display:block; background:#1b5e20; color:#a5d6a7; }
      #mdac-msg.warn{ display:block; background:#e65100; color:#ffcc02; }
      #mdac-msg.info{ display:block; background:#0d47a1; color:#90caf9; }

      #mdac-modal {
        position: fixed; inset: 0; z-index: 1000000;
        background: rgba(0,0,0,0.6); display: none;
        align-items: center; justify-content: center;
      }
      #mdac-modal.show { display: flex; }
      .mdac-modal-box {
        background: #1a1a2e; color: #eee; border-radius: 12px;
        padding: 20px; width: min(640px, 92vw); max-height: 86vh;
        display: flex; flex-direction: column;
      }
      .mdac-modal-box h3 { margin: 0 0 10px; font-size: 16px; }
      .mdac-modal-box textarea {
        flex: 1; min-height: 320px; width: 100%; box-sizing: border-box;
        background: #0f1424; color: #d6e1ff; border: 1px solid #333;
        border-radius: 8px; padding: 10px; font-family: ui-monospace, Menlo, monospace;
        font-size: 12px; resize: vertical;
      }
      .mdac-modal-warn {
        margin-top: 10px; padding: 8px 10px; border-radius: 6px;
        background: #3a2a00; color: #ffd591; font-size: 11px; line-height: 1.5;
      }
      .mdac-modal-actions { display: flex; gap: 8px; margin-top: 12px; }
      .mdac-modal-actions button { flex: 1; padding: 10px; border: none;
        border-radius: 8px; font-weight: 600; cursor: pointer; }
      .mdac-btn-save { background: #4CAF50; color: #fff; }
      .mdac-btn-cancel { background: #555; color: #eee; }
    `;
    document.head.appendChild(style);

    const p = document.createElement('div');
    p.id = 'mdac-panel';
    p.innerHTML = `
      <div class="mdac-header" id="mdac-toggle">
        <span class="mdac-title">🛫 MDAC Autofill</span>
        <span id="mdac-icon">−</span>
      </div>
      <div class="mdac-body">
        <select id="mdac-sel"></select>
        <button class="btn-fill" id="mdac-fill">🤖 Auto Fill</button>
        <div class="mdac-hr"></div>
        <button class="btn-cfg" id="mdac-edit">⚙️ Edit Config</button>
        <div class="mdac-row">
          <button class="btn-paste" id="mdac-export">📤 Export</button>
          <button class="btn-paste" id="mdac-import">📥 Import</button>
        </div>
        <button class="btn-paste" id="mdac-paste">📋 Unlock Paste</button>
        <button class="btn-clear" id="mdac-clear">🗑️ Clear Form</button>
        <div id="mdac-msg"></div>
        <div class="mdac-hint">pick → fill → review → submit → next</div>
      </div>
    `;
    document.body.appendChild(p);

    // Modal
    const modal = document.createElement('div');
    modal.id = 'mdac-modal';
    modal.innerHTML = `
      <div class="mdac-modal-box">
        <h3>⚙️ Edit Config (JSON)</h3>
        <textarea id="mdac-modal-text" spellcheck="false" placeholder='Paste the contents of config.example.json and replace every value with your own.'></textarea>
        <div class="mdac-modal-warn">
          🔒 Your config is stored only in this machine's Tampermonkey storage. Do NOT enable "Sync via Chrome" in Tampermonkey settings, or your config will be uploaded to your Google account.
        </div>
        <div class="mdac-modal-actions">
          <button class="mdac-btn-cancel" id="mdac-modal-cancel">Cancel</button>
          <button class="mdac-btn-save" id="mdac-modal-save">Save</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    // Wire up events
    document.getElementById('mdac-toggle').onclick = () => {
      p.classList.toggle('collapsed');
      document.getElementById('mdac-icon').textContent = p.classList.contains('collapsed') ? '+' : '−';
    };

    document.getElementById('mdac-sel').onchange = (e) => {
      currentIdx = +e.target.value;
      const t = getTravelers()[currentIdx];
      if (t) msg('info', `Selected: ${t.label || t.name}`);
    };

    document.getElementById('mdac-fill').onclick = () => {
      const list = getTravelers();
      const t = list[currentIdx];
      if (!t) { msg('warn', '⚠️ No traveler — edit config first'); return; }
      const n = fillForm(t);
      msg(n > 0 ? 'ok' : 'warn',
        n > 0 ? `✅ Filled ${n} fields — ${t.label || t.name}` : '⚠️ No fields matched — make sure the form is loaded');
    };

    document.getElementById('mdac-paste').onclick = () => {
      enablePaste();
      msg('ok', '✅ Paste restriction removed');
    };

    document.getElementById('mdac-clear').onclick = () => {
      fillRevision++;
      document.querySelectorAll('input[type="text"], textarea').forEach(el => {
        const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        const desc = Object.getOwnPropertyDescriptor(proto, 'value');
        if (desc && desc.set) desc.set.call(el, '');
        else el.value = '';
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      });
      document.querySelectorAll('select').forEach(el => {
        el.selectedIndex = 0;
        el.dispatchEvent(new Event('change', { bubbles: true }));
      });
      msg('info', '🗑️ Form cleared');
    };

    // Config modal
    const openModal = (text) => {
      document.getElementById('mdac-modal-text').value = text;
      modal.classList.add('show');
    };
    const closeModal = () => modal.classList.remove('show');

    document.getElementById('mdac-edit').onclick = () => {
      const text = config ? JSON.stringify(config, null, 2) : '';
      openModal(text);
    };
    document.getElementById('mdac-modal-cancel').onclick = closeModal;
    document.getElementById('mdac-modal-save').onclick = () => {
      const text = document.getElementById('mdac-modal-text').value.trim();
      if (!text) {
        if (confirm('Content is empty. Clear the saved config?')) {
          clearConfig();
          config = null;
          refreshTravelerList();
          closeModal();
          msg('info', '🗑️ Config cleared');
        }
        return;
      }
      try {
        const parsed = JSON.parse(text);
        if (!parsed.travelers || !Array.isArray(parsed.travelers)) {
          throw new Error('config is missing the "travelers" array');
        }
        saveConfig(parsed);
        config = parsed;
        currentIdx = 0;
        refreshTravelerList();
        closeModal();
        msg('ok', `✅ Config saved (${parsed.travelers.length} traveler${parsed.travelers.length === 1 ? '' : 's'})`);
      } catch (e) {
        alert('JSON parse error: ' + e.message);
      }
    };

    document.getElementById('mdac-export').onclick = () => {
      if (!config) { msg('warn', '⚠️ No config to export'); return; }
      const text = JSON.stringify(config, null, 2);
      navigator.clipboard.writeText(text).then(
        () => msg('ok', '✅ Config JSON copied to clipboard'),
        () => { openModal(text); msg('info', 'Shown in dialog — copy manually'); }
      );
    };

    document.getElementById('mdac-import').onclick = () => openModal('');
  }

  function refreshTravelerList() {
    const sel = document.getElementById('mdac-sel');
    if (!sel) return;
    const list = getTravelers();
    if (list.length === 0) {
      sel.innerHTML = `<option>(no config — click ⚙️ Edit Config)</option>`;
      return;
    }
    // Adapter: imported traveler names are text, never HTML.
    sel.replaceChildren(...list.map((t, i) => new Option(
      (t.label ? t.label + ' ' : '') + t.name, String(i)
    )));
  }

  function msg(type, text) {
    const el = document.getElementById('mdac-msg');
    if (!el) return;
    el.className = type; el.textContent = text;
    clearTimeout(el._t);
    el._t = setTimeout(() => { el.className = ''; }, 4000);
  }

  // ============================================================
  // Init
  // ============================================================
  function init() {
    enablePaste();
    config = loadConfig();
    injectUI();
    refreshTravelerList();
    if (!config) {
      msg('warn', '⚠️ No config — click ⚙️ Edit Config to import JSON');
    }
    new MutationObserver(() => {
      document.querySelectorAll('input, textarea').forEach(el => {
        el.onpaste = null;
        el.removeAttribute('onpaste');
      });
    }).observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'complete') init();
  else window.addEventListener('load', init);
})();
