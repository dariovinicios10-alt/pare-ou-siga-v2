/* =====================================================================
   auth.js  —  Autenticação Microsoft Entra ID (Azure AD)
   PKCE sem biblioteca MSAL — mesmo padrão do Levantamento Rodoviário.
   App Registration: "Levantamento Rodoviario"
   ===================================================================== */

const Auth = (() => {
  const CLIENT_ID = "b06106e3-083b-4635-b3b4-525ab54197f6";
  const TENANT_ID = "7876d343-00f5-4c18-9764-5133f545aec6";
  const AUTHORITY = `https://login.microsoftonline.com/${TENANT_ID}`;
  const SCOPES = "openid profile User.Read Sites.ReadWrite.All offline_access";

  // Redirect URI = raiz do app (sem index.html)
  const REDIRECT_URI = window.location.origin +
    window.location.pathname.replace(/\/index\.html$/i, "/").replace(/\/$/, "") + "/";

  let _accessToken = null;
  let _refreshToken = null;
  let _user = null;
  let _tokenExpiry = 0;

  /* ---- PKCE helpers ---- */
  function randomBytes(n) {
    const a = new Uint8Array(n);
    crypto.getRandomValues(a);
    return a;
  }
  function base64url(buffer) {
    return btoa(String.fromCharCode(...new Uint8Array(buffer)))
      .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  function generateCodeVerifier() { return base64url(randomBytes(32)); }
  async function generateCodeChallenge(verifier) {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
    return base64url(digest);
  }

  /* ---- Login (redireciona para Microsoft) ---- */
  async function login() {
    const verifier = generateCodeVerifier();
    const challenge = await generateCodeChallenge(verifier);
    sessionStorage.setItem("pkce_verifier", verifier);

    const params = new URLSearchParams({
      client_id: CLIENT_ID,
      response_type: "code",
      redirect_uri: REDIRECT_URI,
      scope: SCOPES,
      code_challenge: challenge,
      code_challenge_method: "S256",
      response_mode: "query",
    });
    window.location.href = `${AUTHORITY}/oauth2/v2.0/authorize?${params}`;
  }

  /* ---- Tratar retorno do redirect (troca code → tokens) ---- */
  async function handleRedirect() {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const error = params.get("error_description") || params.get("error");
    if (error) { console.error("Auth error:", error); }
    if (!code) return false;

    const verifier = sessionStorage.getItem("pkce_verifier");
    if (!verifier) { console.error("PKCE verifier ausente"); return false; }

    // Limpa URL (remove ?code=...)
    window.history.replaceState({}, document.title, window.location.pathname);
    sessionStorage.removeItem("pkce_verifier");

    const resp = await fetch(`${AUTHORITY}/oauth2/v2.0/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: CLIENT_ID,
        grant_type: "authorization_code",
        code,
        redirect_uri: REDIRECT_URI,
        code_verifier: verifier,
        scope: SCOPES,
      }),
    });

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      console.error("Token exchange failed:", err);
      return false;
    }

    _setTokens(await resp.json());
    return true;
  }

  /* ---- Token silencioso (refresh) ---- */
  async function getToken() {
    // Token válido em memória
    if (_accessToken && Date.now() < _tokenExpiry) return _accessToken;

    // Tenta refresh
    const rt = _refreshToken || localStorage.getItem("ps_rt");
    if (!rt) return null;

    try {
      const resp = await fetch(`${AUTHORITY}/oauth2/v2.0/token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: CLIENT_ID,
          grant_type: "refresh_token",
          refresh_token: rt,
          scope: SCOPES,
        }),
      });
      if (!resp.ok) throw new Error(`Refresh failed: ${resp.status}`);
      _setTokens(await resp.json());
      return _accessToken;
    } catch (e) {
      console.warn("Refresh token expirado, precisa fazer login novamente.", e);
      logout();
      return null;
    }
  }

  /* ---- Logout ---- */
  function logout() {
    _accessToken = null;
    _refreshToken = null;
    _user = null;
    _tokenExpiry = 0;
    localStorage.removeItem("ps_rt");
    localStorage.removeItem("ps_user");
  }

  /* ---- Estado ---- */
  function isLoggedIn() {
    return !!(_accessToken || localStorage.getItem("ps_rt"));
  }
  function getUser() {
    return _user || JSON.parse(localStorage.getItem("ps_user") || "null");
  }

  /* ---- Internals ---- */
  function _setTokens(data) {
    _accessToken = data.access_token;
    _refreshToken = data.refresh_token || _refreshToken;
    _tokenExpiry = Date.now() + ((data.expires_in || 3600) - 120) * 1000; // 2 min de margem

    // Decodifica nome do usuário do id_token (JWT payload)
    if (data.id_token) {
      try {
        const payload = JSON.parse(atob(data.id_token.split(".")[1]));
        _user = { name: payload.name || "", email: payload.preferred_username || "" };
      } catch (_) {}
    }

    if (_refreshToken) localStorage.setItem("ps_rt", _refreshToken);
    if (_user) localStorage.setItem("ps_user", JSON.stringify(_user));
  }

  return { login, logout, handleRedirect, getToken, getUser, isLoggedIn, REDIRECT_URI };
})();
