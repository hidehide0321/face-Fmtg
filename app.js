(() => {
  const $ = (sel, el = document) => el.querySelector(sel);
  const $$ = (sel, el = document) => Array.from(el.querySelectorAll(sel));

  const formRoot = document.getElementById('formRoot');
  const status = document.getElementById('status');
  const siteTitle = document.getElementById('siteTitle');
  const formDescription = document.getElementById('formDescription');

  async function loadConfig() {
    try {
      const resp = await fetch('config.json', { cache: 'no-store' });
      if (!resp.ok) throw new Error(`config.json の取得に失敗しました (HTTP ${resp.status})`);
      return await resp.json();
    } catch (err) {
      if (window.CONFIG) {
        console.warn('config.json の取得に失敗したため window.CONFIG を使用します:', err);
        return window.CONFIG;
      }
      throw err;
    }
  }

  function el(tag, attrs = {}, children = []) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') node.className = v;
      else if (k === 'for') node.htmlFor = v;
      else if (k === 'text') node.textContent = v;
      else if (k === 'html') node.innerHTML = v;
      else node.setAttribute(k, v);
    }
    for (const c of [].concat(children)) if (c) node.appendChild(c);
    return node;
  }

  function renderForm(cfg) {
    formRoot.innerHTML = '';
    siteTitle.textContent = (cfg.form && cfg.form.title) || cfg.siteName || 'アンケート';
    formDescription.textContent = cfg.form?.description || '';

    // Build fields from config: prefer fieldsString over explicit fields
    const fields = buildFieldsFromConfig(cfg.form || {});

    const form = el('form', { novalidate: 'true' });
    for (const field of fields) {
      const fieldWrap = el('div', { class: 'field' });
      const fid = `f_${field.id}`;
      const label = el('label', { for: fid, text: field.label + (field.required ? ' *' : '') });

      let input;
      const common = {
        id: fid,
        name: field.id,
        placeholder: field.placeholder || '',
        'aria-describedby': field.help ? `${fid}_help` : undefined,
        required: field.required ? 'true' : undefined,
      };

      switch ((field.type || 'text').toLowerCase()) {
        case 'textarea':
          input = el('textarea', { ...common, rows: field.rows || 4 });
          break;
        case 'select': {
          input = el('select', common);
          for (const opt of field.options || []) {
            input.appendChild(el('option', { value: opt.value, text: opt.label }));
          }
          break;
        }
        case 'radio': {
          input = el('div', { class: 'choices' });
          for (const opt of field.options || []) {
            const rid = `${fid}_${opt.value}`;
            const r = el('input', { type: 'radio', id: rid, name: field.id, value: opt.value, required: field.required ? 'true' : undefined });
            const rl = el('label', { for: rid, class: 'inline', text: opt.label });
            const wrap = el('div');
            wrap.appendChild(r); wrap.appendChild(rl);
            input.appendChild(wrap);
          }
          break;
        }
        case 'checkbox': {
          input = el('div', { class: 'choices' });
          for (const opt of field.options || []) {
            const cid = `${fid}_${opt.value}`;
            const c = el('input', { type: 'checkbox', id: cid, name: field.id, value: opt.value });
            const cl = el('label', { for: cid, class: 'inline', text: opt.label });
            const wrap = el('div');
            wrap.appendChild(c); wrap.appendChild(cl);
            input.appendChild(wrap);
          }
          break;
        }
        case 'datetime-local': {
          const wrap = el('div', { class: 'dtgroup' });
          const dateId = `${fid}_date`;
          const timeId = `${fid}_time`;
          const dateInput = el('input', { type: 'date', id: dateId, 'aria-label': `${field.label}（日付）` });
          const timeSelect = el('select', { id: timeId, 'aria-label': `${field.label}（時間）` });
          for (const t of (typeof buildTimeSlots === 'function' ? buildTimeSlots(10, 22, 30) : [])) {
            timeSelect.appendChild(el('option', { value: t, text: t }));
          }
          wrap.appendChild(dateInput);
          wrap.appendChild(timeSelect);
          input = wrap;
          break;
        }
        case 'email':
        case 'tel':
        case 'date':
        case 'datetime-local':
        case 'number':
        case 'text':
        default:
          input = el('input', { type: field.type || 'text', ...common });
          if ((field.type || 'text').toLowerCase() === 'datetime-local') {
            // 10:00〜22:00, 30分刻み
            input.setAttribute('step', '1800'); // seconds
            setupDateTimeBounds(input);
          }
      }

      fieldWrap.appendChild(label);
      fieldWrap.appendChild(input);
      if (field.help) fieldWrap.appendChild(el('div', { id: `${fid}_help`, class: 'help', text: field.help }));
      fieldWrap.appendChild(el('div', { id: `${fid}_error`, class: 'error', role: 'alert' }));
      form.appendChild(fieldWrap);
    }

    const actions = el('div', { class: 'actions' });
    const submitBtn = el('button', { type: 'submit', class: 'primary' }, [document.createTextNode('送信する')]);
    const resetBtn = el('button', { type: 'reset', class: 'secondary' }, [document.createTextNode('クリア')]);
    actions.appendChild(submitBtn);
    actions.appendChild(resetBtn);
    form.appendChild(actions);

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      clearErrors();
      const data = collectForm(cfg, form);
      const errors = validate(cfg, data);
      if (Object.keys(errors).length > 0) {
        showErrors(errors);
        return;
      }
      submitBtn.disabled = true;
      showStatus('送信中...', '');
      try {
        await submitWrapper(cfg, data);
        form.reset();
        const msg = cfg.SUCCESS_MESSAGE || cfg.successMessage || (cfg.form && cfg.form.successMessage) || '送信が完了しました。ご協力ありがとうございます。';
        showStatus(msg, 'ok');
        // Redirect to thanks page with message
        try { window.location.href = `./thanks.html?msg=${encodeURIComponent(msg)}`; } catch (_) {}
      } catch (err) {
        console.error(err);
        showStatus('送信に失敗しました。時間をおいて再度お試しください。', 'ng');
      } finally {
        submitBtn.disabled = false;
      }
    });

    // Stash resolved fields (include type/required) so submit/validate can reference rendered schema
    form.dataset.fields = JSON.stringify(fields.map(f => ({ id: f.id, label: f.label, type: (f.type||'text').toLowerCase(), required: !!f.required })));
    formRoot.appendChild(form);
    formRoot.removeAttribute('aria-busy');
  }

  // Set min/max on a datetime-local input so that the time window is 10:00–22:00 of the selected date
  function setupDateTimeBounds(input) {
    const apply = () => {
      const val = input.value || '';
      // derive date part from value or today (local)
      let dStr;
      if (val && val.includes('T')) {
        dStr = val.split('T')[0];
      } else {
        const d = new Date();
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const da = String(d.getDate()).padStart(2, '0');
        dStr = `${y}-${m}-${da}`;
      }
      input.min = `${dStr}T10:00`;
      input.max = `${dStr}T22:00`;
      input.step = '1800';
    };
    apply();
    input.addEventListener('focus', apply);
    input.addEventListener('change', apply);
    input.addEventListener('input', apply);
  }
  // Build time slots like ["10:00", "10:30", ..., "22:00"]
  function buildTimeSlots(startHour = 10, endHour = 22, intervalMin = 30) {
    const slots = [];
    for (let h = startHour; h <= endHour; h++) {
      for (let m = 0; m < 60; m += intervalMin) {
        if (h === endHour && m > 0) break;
        slots.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
      }
    }
    return slots;
  }

  function buildFieldsFromConfig(formCfg) {
    let fields;
    if (formCfg && typeof formCfg.fieldsString === 'string' && formCfg.fieldsString.trim()) {
      fields = parseFieldsString(formCfg.fieldsString.trim());
    } else {
      fields = Array.isArray(formCfg.fields) ? formCfg.fields : [];
    }
    // Rule: 基本は必須。ただし「希望日時」の2つ目以降（②③…）は任意
    return fields.map(f => {
      const base = (f.baseLabel || f.label || '').replace(/[\s　]/g, '');
      const isKibou = /希望?日時/.test(base);
      const idx = f.indexWithinGroup || 1;
      return { ...f, required: isKibou ? idx === 1 : true };
    });
  }

  function parseFieldsString(s) {
    const parts = s.split(/[、,]/).map(t => String(t).replace(/\s+/g, ' ').trim()).filter(Boolean);
    const totalCounts = parts.reduce((m, lab) => (m[lab] = (m[lab] || 0) + 1, m), {});
    const seen = {};
    const circled = ['①','②','③','④','⑤','⑥','⑦','⑧','⑨','⑩'];
    const fields = [];
    for (const rawLabel of parts) {
      const base = rawLabel;
      const idx = (seen[base] || 0) + 1; seen[base] = idx;
      const isGrouped = (totalCounts[base] || 1) > 1;
      const display = isGrouped ? `${base}${circled[idx - 1] || `(${idx})`}` : base;
      const idBase = base.replace(/\s+/g, '');
      const id = isGrouped ? `${idBase}${idx}` : idBase;
      const type = guessType(base);
      const placeholder = guessPlaceholder(type, base);
      const def = { id, label: display, type, placeholder, baseLabel: base, indexWithinGroup: idx };
      if (type === 'textarea') def.rows = 5;
      fields.push(def);
    }
    return fields;
  }

  function guessType(label) {
    if (/メール|mail|e-?mail/i.test(label)) return 'email';
    if (/電話|TEL|Tel|mobile|携帯/i.test(label)) return 'tel';
    if (/希望?日時|日時/.test(label)) return 'datetime-local';
    if (/日付/.test(label)) return 'date';
    if (/ご意見|ご感想|意見|感想|相談|内容|詳細|備考|メッセージ/.test(label)) return 'textarea';
    return 'text';
  }

  function guessRequired(label, count) {
    // 不使用（必須判定は buildFieldsFromConfig で行う）
    return true;
  }

  function guessPlaceholder(type, label) {
    if (type === 'email') return 'example@example.com';
    if (type === 'tel') return '例）090-1234-5678';
    if (type === 'datetime-local') return 'YYYY-MM-DD hh:mm';
    if (type === 'date') return 'YYYY-MM-DD';
    if (type === 'textarea') return `${label}（500文字以内）`;
    return '';
  }

  function collectForm(cfg, form) {
    const out = {};
    for (const field of cfg.form?.fields || []) {
      const type = (field.type || 'text').toLowerCase();
      if (type === 'checkbox') {
        out[field.id] = $$(`input[name="${CSS.escape(field.id)}"]:checked`, form).map(i => i.value);
      } else if (type === 'radio') {
        const sel = $(`input[name="${CSS.escape(field.id)}"]:checked`, form);
        out[field.id] = sel ? sel.value : '';
      } else if (type === 'select') {
        const sel = $(`select[name="${CSS.escape(field.id)}"]`, form);
        out[field.id] = sel ? sel.value : '';
      } else if (type === 'textarea') {
        const t = $(`#f_${field.id}`, form);
        out[field.id] = t ? t.value.trim() : '';
      } else {
        const i = $(`#f_${field.id}`, form);
        out[field.id] = i ? i.value.trim() : '';
      }
    }
    return out;
  }

  function validate(cfg, data) {
    const errors = {};
    for (const field of cfg.form?.fields || []) {
      const v = data[field.id];
      if (field.required) {
        const empty = Array.isArray(v) ? v.length === 0 : !v;
        if (empty) { errors[field.id] = '必須項目です'; continue; }
      }
      if (field.validation) {
        const r = field.validation;
        if (r.minLength && String(v).length < r.minLength) errors[field.id] = `${r.minLength}文字以上で入力してください`;
        if (!errors[field.id] && r.maxLength && String(v).length > r.maxLength) errors[field.id] = `${r.maxLength}文字以内で入力してください`;
        if (!errors[field.id] && r.pattern) {
          try { const re = new RegExp(r.pattern); if (!re.test(String(v))) errors[field.id] = r.message || '形式が正しくありません'; } catch {}
        }
        if (!errors[field.id] && r.type === 'email') {
          const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/; if (!re.test(String(v))) errors[field.id] = 'メール形式が正しくありません';
        }
      }
      // Extra rule for datetime-local: enforce 10:00–22:00, 30-min increments
      if (!errors[field.id] && (field.type || '').toLowerCase() === 'datetime-local') {
        const str = String(v);
        const t = str.split('T')[1] || '';
        const hm = t.split(':');
        if (hm.length >= 2) {
          const h = parseInt(hm[0], 10);
          const m = parseInt(hm[1], 10);
          const inRange = (h > 10 && h < 22) || (h === 10 && m >= 0) || (h === 22 && m === 0);
          const stepOK = (m % 30 === 0);
          if (!inRange || !stepOK) {
            errors[field.id] = '10:00〜22:00の30分刻みで選択してください';
          }
        } else {
          errors[field.id] = '日時の形式が正しくありません';
        }
      }
    }
    return errors;
  }

  function showErrors(errors) {
    for (const [id, msg] of Object.entries(errors)) {
      const err = document.getElementById(`f_${id}_error`);
      if (err) err.textContent = msg;
    }
    showStatus('入力内容をご確認ください。', 'ng');
  }
  function clearErrors() { $$('.error').forEach(e => e.textContent = ''); }
  function showStatus(msg, cls) { status.innerHTML = `<span class="${cls || ''}">${msg}</span>`; }

  async function submit(cfg, data) {
    if (!cfg.gasEndpoint) throw new Error('gasEndpoint が設定されていません');
    const payload = {
      token: cfg.token || '',
      meta: { siteName: cfg.siteName || '', formTitle: cfg.form?.title || '', ts: new Date().toISOString() },
      order: getRenderedFieldIds(),
      headerLabels: getRenderedFieldLabels(),
      fields: data,
    };
    // file:// で開いた場合は iframe 経由で送信（CORS回避）
    if (location.protocol === 'file:') {
      return await submitViaIframe(cfg, payload);
    }
    const body = new URLSearchParams({ payload: JSON.stringify(payload) });
    const resp = await fetch(cfg.gasEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
      body,
      // mode: 'cors' // 既定
    });
    if (!resp.ok) throw new Error(`GAS error: ${resp.status}`);
    const json = await resp.json().catch(() => ({}));
    if (!json.ok) throw new Error('GASがエラーを返しました');
    return json;
  }

  function getRenderedFieldIds() {
    const form = $('form', formRoot);
    try {
      const meta = JSON.parse(form?.dataset?.fields || '[]');
      return meta.map(m => m.id);
    } catch { return []; }
  }

  function getRenderedFieldLabels() {
    const form = $('form', formRoot);
    try {
      const meta = JSON.parse(form?.dataset?.fields || '[]');
      return meta.map(m => m.label);
    } catch { return []; }
  }

  // Override with rendered-schema aware versions
  function getRenderedMeta(form) { try { return JSON.parse(form?.dataset?.fields || '[]'); } catch { return []; } }

  // --- CORS回避用: hidden iframe でPOST ---
  function ensureHiddenIframe(name = 'hidden_iframe') {
    let iframe = document.querySelector(`iframe[name="${name}"]`);
    if (!iframe) {
      iframe = document.createElement('iframe');
      iframe.name = name;
      iframe.style.display = 'none';
      document.body.appendChild(iframe);
    }
    return iframe;
  }

  function submitViaIframe(cfg, payload) {
    return new Promise((resolve, reject) => {
      try {
        if (!cfg.gasEndpoint) throw new Error('gasEndpoint が未設定です');
        const iframe = ensureHiddenIframe();
        const form = document.createElement('form');
        form.method = 'POST';
        form.action = cfg.gasEndpoint;
        form.target = 'hidden_iframe';
        form.style.display = 'none';
        const input = document.createElement('input');
        input.type = 'hidden';
        input.name = 'payload';
        input.value = JSON.stringify(payload);
        form.appendChild(input);
        if (cfg.token) {
          const tok = document.createElement('input');
          tok.type = 'hidden';
          tok.name = 'token';
          tok.value = cfg.token;
          form.appendChild(tok);
        }
        const onLoad = () => {
          iframe.removeEventListener('load', onLoad);
          resolve({ ok: true });
          try { form.remove(); } catch {}
        };
        iframe.addEventListener('load', onLoad);
        document.body.appendChild(form);
        form.submit();
      } catch (err) {
        reject(err);
      }
    });
  }

  // フォーム送信の実体（fetch）に、iframeフォールバックをかけるラッパ
  async function submitWrapper(cfg, data) {
    // file:// で開いている場合は最初から iframe で送信
    if (location.protocol === 'file:') {
      const payload1 = {
        token: cfg.token || '',
        meta: { siteName: cfg.siteName || '', formTitle: (cfg.form && cfg.form.title) || '', ts: new Date().toISOString() },
        order: getRenderedFieldIds(),
        headerLabels: getRenderedFieldLabels(),
        fields: data,
      };
      return await submitViaIframe(cfg, payload1);
    }
    try {
      return await submit(cfg, data);
    } catch (err) {
      const payload2 = {
        token: cfg.token || '',
        meta: { siteName: cfg.siteName || '', formTitle: (cfg.form && cfg.form.title) || '', ts: new Date().toISOString() },
        order: getRenderedFieldIds(),
        headerLabels: getRenderedFieldLabels(),
        fields: data,
      };
      return await submitViaIframe(cfg, payload2);
    }
  }

  function collectForm(cfg, form) {
    const out = {};
    const meta = getRenderedMeta(form);
    for (const field of meta) {
      const type = (field.type || 'text').toLowerCase();
      if (type === 'checkbox') {
        out[field.id] = $$(`input[name="${CSS.escape(field.id)}"]:checked`, form).map(i => i.value);
      } else if (type === 'radio') {
        const sel = $(`input[name="${CSS.escape(field.id)}"]:checked`, form);
        out[field.id] = sel ? sel.value : '';
      } else if (type === 'select') {
        const sel = $(`select[name="${CSS.escape(field.id)}"]`, form);
        out[field.id] = sel ? sel.value : '';
      } else if (type === 'datetime-local') {
        const d = $(`#f_${field.id}_date`, form);
        const t = $(`#f_${field.id}_time`, form);
        const dv = d && d.value ? d.value : '';
        const tv = t && t.value ? t.value : '';
        out[field.id] = dv && tv ? `${dv}T${tv}` : '';
      } else if (type === 'textarea') {
        const t = $(`#f_${field.id}`, form);
        out[field.id] = t ? t.value.trim() : '';
      } else {
        const i = $(`#f_${field.id}`, form);
        out[field.id] = i ? i.value.trim() : '';
      }
    }
    return out;
  }

  function validate(cfg, data) {
    const errors = {};
    const form = document.querySelector('form');
    const meta = getRenderedMeta(form);
    for (const field of meta) {
      const v = data[field.id];
      if (field.required) {
        const empty = Array.isArray(v) ? v.length === 0 : !v;
        if (empty) { errors[field.id] = '必須項目です'; continue; }
      }
      if (field.validation) {
        const r = field.validation;
        if (r.minLength && String(v).length < r.minLength) errors[field.id] = `${r.minLength}文字以上で入力してください`;
        if (!errors[field.id] && r.maxLength && String(v).length > r.maxLength) errors[field.id] = `${r.maxLength}文字以内で入力してください`;
        if (!errors[field.id] && r.pattern) {
          try { const re = new RegExp(r.pattern); if (!re.test(String(v))) errors[field.id] = r.message || '形式が正しくありません'; } catch {}
        }
        if (!errors[field.id] && r.type === 'email') {
          const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/; if (!re.test(String(v))) errors[field.id] = 'メール形式が正しくありません';
        }
      }
      if ((field.type || '').toLowerCase() === 'datetime-local') {
        if (!v) {
          if (field.required) errors[field.id] = '日付と時間を選択してください';
        } else {
          const t = String(v).split('T')[1] || '';
          const slots = new Set((typeof buildTimeSlots === 'function') ? buildTimeSlots(10, 22, 30) : []);
          if (!slots.has(t)) errors[field.id] = '10:00〜22:00の30分刻みから選択してください';
        }
      }
    }
    return errors;
  }

  (async function init() {
    try {
      const cfg = await loadConfig();
      renderForm(cfg);
    } catch (e) {
      console.error('設定読み込みエラー:', e);
      const hint = `設定の読み込みに失敗しました。\n` +
        `・ローカルサーバーで http(s) から開いているか確認してください\n` +
        `・URLで config.json に直接アクセスして表示できるか確認してください\n` +
        `・config.json の JSON 構文エラーがないか確認してください`;
      formRoot.innerHTML = `<div class="loading">${hint}</div>`;
    }
  })();
})();
