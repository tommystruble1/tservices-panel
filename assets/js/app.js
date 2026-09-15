/* Yaoki Panel — app (panel.tservices.cc)
   ---------------------------------------------------------------------------
   Separate origin from the main site, so its own localStorage / session, but
   the same Better Auth + token backend. Magic-link sign-in, then one "My
   tokens" hub gated by the account's server-resolved role:
     any signed-in user -> claim + view their own tokens
     reseller           -> + mint (credit-based) via presets or the form
     admin ("Dev")      -> + tester tokens, assign-to-email, all tokens,
                            and manage resellers/roles
   Every gate is re-checked on the server; nothing trusts the client. */
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

    // hub: mint (staff)
    hubCredits: $('hubCredits'), hubMint: $('hubMint'),
    hubDur: $('hubDur'), hubType: $('hubType'), hubTesterBtn: $('hubTesterBtn'), hubGenList: $('hubGenList'),
    hubMintBtn: $('hubMintBtn'), hubMintMsg: $('hubMintMsg'),

    // hub: claim (everyone)
    claimForm: $('claimForm'), claimInput: $('claimInput'), claimMsg: $('claimMsg'),

    // hub: list
    hubListTitle: $('hubListTitle'), myList: $('myList'), myEmpty: $('myEmpty'),

    // admin: manage resellers/roles
    admUsersPanel: $('admUsersPanel'), admUserForm: $('admUserForm'),
    admUserEmail: $('admUserEmail'), admUserRole: $('admUserRole'),
    admUserCredits: $('admUserCredits'), admUserMsg: $('admUserMsg')
  };

  /* ---------- view switch ---------- */
  function show(name) {
    ['unconfigured', 'loading', 'signedOut', 'noAccess', 'panels'].forEach(function (k) {
      if (els[k]) els[k].hidden = (k !== name);
    });
  }
  function say(el, text, kind) {
    if (!el) return;
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
  function copy(text) { try { navigator.clipboard.writeText(text); } catch (e) {} }

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
    var admin = (role === 'admin');
    var staff = (admin || role === 'reseller');
    show('panels');

    // mint hub — staff only
    els.hubMint.hidden = !staff;
    // credits pill — resellers (admins are unlimited)
    if (role === 'reseller') { els.hubCredits.hidden = false; els.hubCredits.textContent = state.credits + ' credits'; }
    else els.hubCredits.hidden = true;
    // admin-only fields
    els.hubTesterBtn.hidden = !admin;
    // admin management
    els.admUsersPanel.hidden = !admin;

    els.hubListTitle.textContent = admin ? 'All tokens' : 'Your tokens';
    loadHubList();
  }

  /* ---------- rendering ---------- */
  function fmtExpires(e) { return e ? String(e).slice(0, 10) : 'never'; }
  function badge(text, cls) {
    var s = document.createElement('span');
    s.className = 'tag' + (cls ? ' tag--' + cls : '');
    s.textContent = text;
    return s;
  }
  function keyCode(k) {
    var c = document.createElement('code');
    c.className = 'tokkey'; c.textContent = k; c.title = 'Click to copy';
    c.addEventListener('click', function () { copy(k); c.classList.add('copied'); setTimeout(function () { c.classList.remove('copied'); }, 900); });
    return c;
  }
  function metaFor(t) {
    var meta = document.createElement('div'); meta.className = 'tok__meta';
    meta.appendChild(badge(t.tier));
    if (t.tester) meta.appendChild(badge('tester', 'tester'));
    meta.appendChild(badge('exp ' + fmtExpires(t.expires)));
    if (t.hwid) meta.appendChild(badge('bound', 'muted'));
    if (t.revoked) meta.appendChild(badge('revoked', 'bad'));
    if (t.owner_email) meta.appendChild(badge('owner ' + t.owner_email, 'muted'));
    if (state.role === 'admin' && t.created_by_email) meta.appendChild(badge('by ' + t.created_by_email, 'muted'));
    if (t.note) meta.appendChild(badge(t.note, 'muted'));
    return meta;
  }

  /* ---------- token list (role-appropriate) ---------- */
  function loadHubList() {
    els.myList.textContent = ''; els.myEmpty.hidden = true;
    var staff = (state.role === 'admin' || state.role === 'reseller');
    var path = staff ? '/api/tokens' : '/api/my-tokens';
    api(path, { method: 'GET' }).then(function (data) {
      var toks = (data && data.tokens) || [];
      if (!toks.length) { els.myEmpty.hidden = false; return; }
      toks.forEach(function (t) { els.myList.appendChild(staff ? staffRow(t) : userRow(t)); });
    }).catch(function () { els.myEmpty.hidden = false; });
  }

  function userRow(t) {
    var li = document.createElement('li'); li.className = 'tok';
    li.appendChild(keyCode(t.token_key));
    li.appendChild(metaFor(t));
    return li;
  }
  function staffRow(t) {
    var li = document.createElement('li'); li.className = 'tok tok--admin';
    var top = document.createElement('div'); top.className = 'tok__top';
    top.appendChild(keyCode(t.token_key));
    top.appendChild(metaFor(t));
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
        .then(function () { loadHubList(); })
        .catch(function (err) { b.disabled = false; window.alert(err.message); });
    });
    return b;
  }

  /* ---------- minting ---------- */
  function refreshCredits() {
    if (state.role !== 'reseller') return;
    api('/api/me', { method: 'GET' }).then(function (me) {
      state.credits = me.credits;
      els.hubCredits.textContent = me.credits + ' credits';
    }).catch(function () {});
  }
  function genRow(tok) {
    var li = document.createElement('li'); li.className = 'tok';
    li.appendChild(keyCode(tok.token_key));
    var meta = metaFor(tok);
    meta.appendChild(badge('click key to copy', 'muted'));
    li.appendChild(meta);
    els.hubGenList.insertBefore(li, els.hubGenList.firstChild);
  }
  function mint(body) {
    return jpost('/api/tokens', body).then(function (data) {
      genRow(data.token);
      loadHubList();
      refreshCredits();
      return data.token;
    });
  }

  var quickDays = 30, quickTier = 'standard', quickTester = false;
  function selectIn(container, btn) {
    Array.prototype.forEach.call(container.querySelectorAll('button'), function (x) { x.classList.remove('is-active'); });
    btn.classList.add('is-active');
  }
  function wireQuick() {
    // duration picker
    if (els.hubDur) {
      Array.prototype.forEach.call(els.hubDur.querySelectorAll('button[data-days]'), function (b) {
        b.addEventListener('click', function () {
          quickDays = parseInt(b.getAttribute('data-days'), 10) || 0;
          selectIn(els.hubDur, b);
        });
      });
    }
    // type picker
    if (els.hubType) {
      Array.prototype.forEach.call(els.hubType.querySelectorAll('button[data-tier]'), function (b) {
        b.addEventListener('click', function () {
          quickTier = b.getAttribute('data-tier') || 'standard';
          quickTester = b.getAttribute('data-tester') === '1';
          selectIn(els.hubType, b);
        });
      });
    }
    // mint button
    if (els.hubMintBtn) {
      els.hubMintBtn.addEventListener('click', function () {
        els.hubMintBtn.disabled = true;
        say(els.hubMintMsg, 'Minting…', '');
        mint({ tier: quickTier, days: quickDays, tester: quickTester })
          .then(function (tok) { els.hubMintBtn.disabled = false; say(els.hubMintMsg, 'Created ' + tok.token_key + ' — click it above to copy.', 'ok'); })
          .catch(function (err) { els.hubMintBtn.disabled = false; say(els.hubMintMsg, err.message, 'err'); });
      });
    }
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

    // claim (everyone)
    els.claimForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var key = els.claimInput.value.trim();
      if (!key) { say(els.claimMsg, 'Enter a token.', 'err'); return; }
      say(els.claimMsg, 'Adding…', '');
      jpost('/api/my-tokens', { token: key }).then(function () {
        els.claimInput.value = ''; say(els.claimMsg, 'Token added to your account.', 'ok'); loadHubList();
      }).catch(function (err) { say(els.claimMsg, err.message, 'err'); });
    });

    // admin: manage resellers / roles
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

    wireQuick();
  }

  /* Cross-tab sign-in: when the magic link is opened in another tab of the
     same browser, it stores the session token in localStorage, firing a
     `storage` event in every OTHER tab. A tab still on the sign-in screen
     picks it up here and signs itself in (same-browser only). */
  window.addEventListener('storage', function (e) {
    if (e.key !== 'ts_auth_token') return;
    if (e.newValue) loadMe();
    else { els.who.hidden = true; els.signOut.hidden = true; toEmailForm(); show('signedOut'); }
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
