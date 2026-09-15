/* Shared config for talking to the same Better Auth + Stripe backend the main
   site uses (server/ in the tservices repo, deployed on Vercel). This panel is
   a separate origin (panel.tservices.cc), so it has its own localStorage and
   its own session — but it talks to the exact same API. The backend allows
   this origin via ALLOWED_ORIGINS. */
(function () {
  'use strict';

  /* ===== the deployed Better Auth + token backend ===== */
  var BACKEND_URL = 'https://tservices-server.vercel.app';
  /* ==================================================== */

  var TOKEN_KEY = 'ts_auth_token';

  function getToken() {
    try { return localStorage.getItem(TOKEN_KEY); } catch (err) { return null; }
  }
  function setToken(token) {
    try {
      if (token === null) localStorage.removeItem(TOKEN_KEY);
      else localStorage.setItem(TOKEN_KEY, token);
    } catch (err) { /* no persistence available */ }
  }
  function authFetch(path, options) {
    options = options || {};
    options.headers = options.headers || {};
    var token = getToken();
    if (token) options.headers.Authorization = 'Bearer ' + token;
    return fetch(BACKEND_URL.replace(/\/+$/, '') + path, options);
  }

  window.TS = {
    BACKEND_URL: BACKEND_URL,
    getToken: getToken,
    setToken: setToken,
    authFetch: authFetch
  };
})();
