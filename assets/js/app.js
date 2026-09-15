/* T's Services — Panel app (panel.tservices.cc)
   ---------------------------------------------------------------------------
   Separate origin from the main site, so its own localStorage / session, but
   the same Better Auth + token backend. Sign in with a magic link, then the
   UI is gated by the role the server reports for the account:
     any signed-in user -> My tokens (claim + view)
     reseller           -> + mint (credit-based) + own token list
     admin              -> + tester tokens, assign, manage resellers, all tokens
   Nothing here trusts the client's claim about its own role; every gate is
   re-checked on the server. */
(function () {
  'use strict';

  var TIMEOUT_MS = 12000;
  var state = { role: 'user', credits: 0, email: '' };
  var sentTo = '';

  function $(id) { return document.getElementById(id); }
  var els = {
    who: $('who'), signOut: $('signOut'),
    unconfigured: $('stUnconfigured'), loading: $('stLoading'),
    signedOut: $('stSignedOut'), noAccess: $('stNoAccess'), panels: $('stPanels'),

    soForm: $('soForm'), soEmail: $('soEmail'), soSubmit: $('soSubmit'),
    soTitle: $('soTitle'), soHint: $('soHint'), soMsg: $('soMsg'),
    soResend: $('soResend'), soRestart: $('soRestart'),

    claimForm: $('claimForm'), claimInput: $('claimInput'), claimMsg: $('claimMsg'),
    myList: $('myList'), myEmpty: $('myEmpty'),

    resPanel: $('resPanel'), resCredits: $('resCredits'), resForm: $('resForm'),
    resTier: $('resTier'), resDays: $('resDays'), resNote: $('resNote'), resMsg: $('resMsg'),

    admPanel: $('admPanel'), admForm: $('admForm'), admTier: $('admTier'),
    admDays: $('admDays'), admTester: $('admTester'), admAssign: $('admAssign'),
    admNote: $('admNote'), admMsg: $('admMsg'),

    admUsersPanel: $('admUsersPanel'), admUserForm: $('admUserForm'),
    admUserEmail: $('admUserEmail'), admUserRole: $('admUserRole'),
    admUserCredits: $('admUserCredits'), admUserMsg: $('admUserMsg'),

    listPanel: $('listPanel'), listTitle: $('listTitle'),
    admList: $('admList'), admEmpty: $('admEmpty')
  };

  /* ---------- view switch ---------- */
  function show(name) {
    ['unconfigured', 'loading', 'signedOut', 'noAccess', 'panels'].forEach(function (k) {
      if (els[k]) els[k].hidden = (k !== name);
    });
  }
  function say(el, text, kind) {
    el.textContent = text || '';
    el.className = 'msg' + (kind ? ' msg--' + kind : '');
  }

  /* ---------- fetch helpers ---------- */
  function timeoutFetch(path, options) {
    var controller = window.AbortController ? new AbortController() : null;
    var timer = setTimeout(function () { if (controller) controller.abort(); }, TIMEOUT_MS);
    options = options || {};
    if (controller) options.signal = controller.signal;
    return window.TS.authFetch(path, options)
      .catch(function () { throw new Error('Could not reach the server. Try again.'); })
      .then(function (res) { clearTimeout(timer); return res; },
            function (err) { clearTimeout(timer); throw err; });
  }
  function api(path, options) {
    return timeoutFetch(path, options).then(function (res) {
      var t = res.headers.get('set-auth-token');
      if (t) window.TS.setToken(t);
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (!res.ok) throw new Error((data && (data.error || data.message)) || ('Error ' + res.status));
        return data;
      });
    });
  }
  function jpost(path, body) {
    return api(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
  }

  function copy(text) {
    try { navigator.clipboard.writeText(text); } catch (e) {}
  }

  /* ---------- sign in ---------- */
  function toEmailForm() {
    els.soTitle.textContent = 'Sign in';
    els.soHint.textContent = "Enter your email and we'll send a sign-in link. No password.";
    els.soResend.hidden = true; els.soRestart.hidden = true;
    els.soEmail.disabled = false; els.soSubmit.disabled = false;
    els.soSubmit.textContent = 'Email me a link';
    say(els.soMsg, '', '');
  }
  function toSentState(email) {
    sentTo = email;
    els.soTitle.textContent = 'Check your email';
    els.soHint.textContent = 'We sent a sign-in link to ' + email + '. Open it to finish.';
    els.soEmail.disabled = true; els.soSubmit.disabled = true; els.soSubmit.textContent = 'Link sent';
    els.soResend.hidden = false; els.soResend.disabled = false;
    els.soRestart.hidden = false;
    say(els.soMsg, 'Link sent. Check your inbox (and spam).', 'ok');
  }
  function sendLink(email) {
    return jpost('/api/auth/sign-in/magic-link', { email: email, callbackURL: window.location.origin + '/' });
  }

  function verifyMagic(token) {
    show('loading');
    return timeoutFetch('/api/auth/magic-link/verify?token=' + encodeURIComponent(token), { method: 'GET' })
      .then(function (res) {
        var t = res.headers.get('set-auth-token');
        if (t) window.TS.setToken(t);
        return res.json().catch(function () { return null; });
      })
      .then(function (data) {
        if (data && data.token) window.TS.setToken(data.token);
        if (window.TS.getToken()) return loadMe();
        throw new Error('bad');
      })
      .catch(function () {
        window.TS.setToken(null); toEmailForm(); show('signedOut');
        say(els.soMsg, 'That link expired or was already used. Request a new one.', 'err');
      });
  }

  /* ---------- account / role ---------- */
  function loadMe() {
    show('loading');
    return api('/api/me', { method: 'GET' }).then(function (me) {
      state.role = me.role; state.credits = me.credits; state.email = me.email;
      els.who.textContent = me.email + ' · ' + me.role;
      els.who.hidden = false; els.signOut.hidden = false;
      showPanels();
    }).catch(function () {
      window.TS.setToken(null); els.who.hidden = true; els.signOut.hidden = true;
      toEmailForm(); show('signedOut');
    });
  }

  function showPanels() {
    var role = state.role;
    var staff = (role === 'admin' || role === 'reseller');
    show('panels');
    els.resPanel.hidden = !staff;
    els.admPanel.hidden = (role !== 'admin');
    els.admUsersPanel.hidden = (role !== 'admin');
    els.listPanel.hidden = !staff;
    els.listTitle.textContent = (role === 'admin') ? 'All tokens' : 'Your tokens';
    els.resCredits.textContent = state.credits + ' credits';

    loadMyTokens();
    if (staff) loadTokens();
  }

  /* ---------- My tokens ---------- */
  function fmtExpires(e) { return e ? String(e).slice(0, 10) : 'never'; }

  function badge(text, cls) {
    var s = document.createElement('span');
    s.className = 'tag' + (cls ? ' tag--' + cls : '');
    s.textContent = text;
    return s;
  }
  function keyCode(k) {
    var c = document.createElement('code');
    c.className = 'tokkey';
    c.textContent = k;
    c.title = 'Click to copy';
    c.addEventListener('click', function () { copy(k); c.classList.add('copied'); setTimeout(function () { c.classList.remove('copied'); }, 900); });
    return c;
  }

  function loadMyTokens() {
    els.myList.textContent = ''; els.myEmpty.hidden = true;
    api('/api/my-tokens', { method: 'GET' }).then(function (data) {
      var toks = (data && data.tokens) || [];
      if (!toks.length) { els.myEmpty.hidden = false; return; }
      toks.forEach(function (t) {
        var li = document.createElement('li'); li.className = 'tok';
        li.appendChild(keyCode(t.token_key));
        var meta = document.createElement('div'); meta.className = 'tok__meta';
        meta.appendChild(badge(t.tier));
        if (t.tester) meta.appendChild(badge('tester', 'tester'));
        meta.appendChild(badge('exp ' + fmtExpires(t.expires)));
        if (t.hwid) meta.appendChild(badge('bound', 'muted'));
        if (t.revoked) meta.appendChild(badge('revoked', 'bad'));
        li.appendChild(meta);
        els.myList.appendChild(li);
      });
    }).catch(function () { say(els.claimMsg, 'Could not load your tokens.', 'err'); });
  }

  /* ---------- staff token list ---------- */
  function loadTokens() {
    els.admList.textContent = ''; els.admEmpty.hidden = true;
    api('/api/tokens', { method: 'GET' }).then(function (data) {
      var toks = (data && data.tokens) || [];
      if (!toks.length) { els.admEmpty.hidden = false; return; }
      toks.forEach(function (t) { els.admList.appendChild(staffRow(t)); });
    }).catch(function () { els.admEmpty.hidden = false; });
  }

  function staffRow(t) {
    var li = document.createElement('li'); li.className = 'tok tok--admin';
    var top = document.createElement('div'); top.className = 'tok__top';
    top.appendChild(keyCode(t.token_key));

    var meta = document.createElement('div'); meta.className = 'tok__meta';
    meta.appendChild(badge(t.tier));
    if (t.tester) meta.appendChild(badge('tester', 'tester'));
    meta.appendChild(badge('exp ' + fmtExpires(t.expires)));
    if (t.hwid) meta.appendChild(badge('bound', 'muted'));
    if (t.revoked) meta.appendChild(badge('revoked', 'bad'));
    if (t.owner_email) meta.appendChild(badge('owner ' + t.owner_email, 'muted'));
    if (t.created_by_email && state.role === 'admin') meta.appendChild(badge('by ' + t.created_by_email, 'muted'));
    if (t.note) meta.appendChild(badge(t.note, 'muted'));
    top.appendChild(meta);
    li.appendChild(top);

    var actions = document.createElement('div'); actions.className = 'tok__actions';
    if (!t.revoked) actions.appendChild(actionBtn('Revoke', 'revoke', t.id));
    if (t.hwid)     actions.appendChild(actionBtn('Unbind', 'unbind', t.id));
    actions.appendChild(actionBtn('Delete', 'delete', t.id, true));
    li.appendChild(actions);
    return li;
  }

  function actionBtn(label, action, id, danger) {
    var b = document.createElement('button');
    b.className = 'btn btn--sm' + (danger ? ' btn--danger' : ' btn--ghost');
    b.type = 'button'; b.textContent = label;
    b.addEventListener('click', function () {
      if (action === 'delete' && !window.confirm('Delete this token permanently?')) return;
      b.disabled = true;
      jpost('/api/token-action', { id: id, action: action })
        .then(function () { loadTokens(); loadMyTokens(); })
        .catch(function (err) { b.disabled = false; window.alert(err.message); });
    });
    return b;
  }

  /* ---------- reseller mint ---------- */
  function wireResMint() {
    els.resForm.addEventListener('submit', function (e) {
      e.preventDefault();
      say(els.resMsg, 'Minting…', '');
      jpost('/api/tokens', {
        tier: els.resTier.value,
        days: parseInt(els.resDays.value, 10) || 0,
        note: els.resNote.value
      }).then(function (data) {
        say(els.resMsg, 'Token: ' + data.token.token_key + '  (click a key to copy)', 'ok');
        els.resNote.value = '';
        // credits changed — refresh from server
        return api('/api/me', { method: 'GET' });
      }).then(function (me) {
        state.credits = me.credits; els.resCredits.textContent = me.credits + ' credits';
        loadTokens();
      }).catch(function (err) { say(els.resMsg, err.message, 'err'); });
    });
  }

  /* ---------- admin mint ---------- */
  function wireAdmMint() {
    els.admForm.addEventListener('submit', function (e) {
      e.preventDefault();
      say(els.admMsg, 'Creating…', '');
      jpost('/api/tokens', {
        tier: els.admTier.value,
        days: parseInt(els.admDays.value, 10) || 0,
        tester: els.admTester.checked,
        assignEmail: els.admAssign.value.trim(),
        note: els.admNote.value
      }).then(function (data) {
        say(els.admMsg, 'Token: ' + data.token.token_key, 'ok');
        els.admAssign.value = ''; els.admNote.value = ''; els.admTester.checked = false;
        loadTokens();
      }).catch(function (err) { say(els.admMsg, err.message, 'err'); });
    });
  }

  /* ---------- admin manage users ---------- */
  function wireAdmUsers() {
    els.admUserForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var body = { email: els.admUserEmail.value.trim() };
      if (els.admUserRole.value) body.role = els.admUserRole.value;
      var add = parseInt(els.admUserCredits.value, 10) || 0;
      if (add !== 0) body.addCredits = add;
      say(els.admUserMsg, 'Applying…', '');
      jpost('/api/admin-user', body).then(function (data) {
        var u = data.user;
        say(els.admUserMsg, u.email + ' → role ' + u.role + ', ' + u.credits + ' credits', 'ok');
        els.admUserCredits.value = '0';
      }).catch(function (err) { say(els.admUserMsg, err.message, 'err'); });
    });
  }

  /* ---------- static events ---------- */
  function wire() {
    els.soForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var email = els.soEmail.value.trim();
      if (!email || email.indexOf('@') === -1) { say(els.soMsg, 'Enter a valid email.', 'err'); return; }
      els.soSubmit.disabled = true; say(els.soMsg, 'Sending…', '');
      sendLink(email).then(function () { toSentState(email); })
        .catch(function (err) { say(els.soMsg, err.message, 'err'); els.soSubmit.disabled = false; });
    });
    els.soResend.addEventListener('click', function () {
      if (!sentTo) return; els.soResend.disabled = true; say(els.soMsg, 'Sending…', '');
      sendLink(sentTo).then(function () { els.soResend.disabled = false; say(els.soMsg, 'New link sent.', 'ok'); })
        .catch(function (err) { els.soResend.disabled = false; say(els.soMsg, err.message, 'err'); });
    });
    els.soRestart.addEventListener('click', function () { els.soEmail.value = ''; toEmailForm(); els.soEmail.focus(); });

    els.signOut.addEventListener('click', function () {
      var had = !!window.TS.getToken();
      window.TS.setToken(null); els.who.hidden = true; els.signOut.hidden = true;
      toEmailForm(); show('signedOut');
      if (had) jpost('/api/auth/sign-out', {}).catch(function () {});
    });

    els.claimForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var key = els.claimInput.value.trim();
      if (!key) { say(els.claimMsg, 'Enter a token.', 'err'); return; }
      say(els.claimMsg, 'Adding…', '');
      jpost('/api/my-tokens', { token: key }).then(function () {
        els.claimInput.value = ''; say(els.claimMsg, 'Token added.', 'ok'); loadMyTokens();
      }).catch(function (err) { say(els.claimMsg, err.message, 'err'); });
    });

    wireResMint(); wireAdmMint(); wireAdmUsers();
  }

  /* Cross-tab sign-in: when the magic link is opened in another tab of the
     same browser, it stores the session token in localStorage — which fires a
     `storage` event in every OTHER tab. A tab still sitting on the sign-in
     screen picks that up here and signs itself in, so you don't have to come
     back and refresh it. (Different physical devices have separate storage, so
     this covers same-browser only.) */
  window.addEventListener('storage', function (e) {
    if (e.key !== 'ts_auth_token') return;
    if (e.newValue) {
      loadMe();
    } else {
      els.who.hidden = true; els.signOut.hidden = true;
      toEmailForm(); show('signedOut');
    }
  });

  /* ---------- boot ---------- */
  wire();
  toEmailForm();

  if (!window.TS || !window.TS.BACKEND_URL) { show('unconfigured'); return; }

  var magicToken = (window.location.hash.match(/[#&?]magic=([^&]+)/) || [])[1] ||
                   (window.location.search.match(/[?&]magic=([^&]+)/) || [])[1];
  if (magicToken) {
    try { history.replaceState(null, '', window.location.pathname); } catch (e) {}
    verifyMagic(decodeURIComponent(magicToken));
    return;
  }

  if (window.TS.getToken()) loadMe();
  else { toEmailForm(); show('signedOut'); }
})();
