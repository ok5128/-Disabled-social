/**
 * 道心账号系统前端模块
 * 注入到 app.js，实现：设备自动注册 → 第三方登录 → 手机/邮箱绑定
 * 不涉及密码
 */
(function () {
  "use strict";

  const AUTH_BASE = window.DaoxinAuthBase || "";  // 留空则用相对路径（同域）

  /* ──── Storage ──── */
  function getDeviceId() {
    let id = localStorage.getItem("daoxin_device_id");
    if (!id) {
      id = "dev-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
      localStorage.setItem("daoxin_device_id", id);
    }
    return id;
  }

  function getToken() { return localStorage.getItem("daoxin_token") || ""; }
  function setToken(t) { localStorage.setItem("daoxin_token", t); }
  function getUser() { try { return JSON.parse(localStorage.getItem("daoxin_user") || "null"); } catch { return null; } }
  function setUser(u) { localStorage.setItem("daoxin_user", JSON.stringify(u)); }

  /* ──── API helper ──── */
  async function authFetch(path, options = {}) {
    const token = getToken();
    const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
    if (token) headers["Authorization"] = `Bearer ${token}`;
    const base = AUTH_BASE || "";
    const res = await fetch(`${base}${path}`, { ...options, headers });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || res.statusText);
    return data;
  }

  /* ──── Auto-register on first visit ──── */
  async function autoRegister() {
    const existingToken = getToken();
    if (existingToken) {
      // Verify existing token
      try {
        const me = await authFetch("/api/auth/me");
        setUser(me);
        return me;
      } catch {
        // Token expired, try refresh
        try {
          const refreshed = await authFetch("/api/auth/refresh", { method: "POST" });
          setToken(refreshed.token);
          setUser(refreshed);
          return refreshed;
        } catch {
          // Need to re-register
          localStorage.removeItem("daoxin_token");
        }
      }
    }

    // Register with device ID
    const deviceId = getDeviceId();
    try {
      const result = await authFetch("/api/auth/device", {
        method: "POST",
        body: JSON.stringify({ device_id: deviceId, app_id: "daoxin-v2" }),
      });
      setToken(result.token);
      setUser(result);
      return result;
    } catch (e) {
      console.error("Auto-register failed:", e);
      return null;
    }
  }

  /* ──── OAuth login ──── */
  function getOAuthProviders() { return authFetch("/api/auth/providers"); }

  // WeChat
  function wechatLogin() {
    const appId = ""; // Will be set from providers endpoint
    const redirectUri = encodeURIComponent(`${window.location.origin}/auth/callback`);
    const state = getDeviceId();
    window.location.href = `https://open.weixin.qq.com/connect/oauth2/authorize?appid=${appId}&redirect_uri=${redirectUri}&response_type=code&scope=snsapi_userinfo&state=${state}#wechat_redirect`;
  }

  // Google
  function googleLogin() {
    const clientId = ""; // Will be set from providers endpoint
    const redirectUri = encodeURIComponent(`${window.location.origin}/auth/callback`);
    const state = getDeviceId();
    window.location.href = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${clientId}&redirect_uri=${redirectUri}&response_type=code&scope=openid%20profile%20email&state=${state}`;
  }

  // Apple
  function appleLogin() {
    const clientId = "";
    const redirectUri = encodeURIComponent(`${window.location.origin}/auth/callback`);
    window.location.href = `https://appleid.apple.com/auth/authorize?client_id=${clientId}&redirect_uri=${redirectUri}&response_type=code&scope=name%20email&response_mode=form_post`;
  }

  // Alipay
  function alipayLogin() {
    const appId = "";
    const redirectUri = encodeURIComponent(`${window.location.origin}/auth/callback`);
    window.location.href = `https://openauth.alipay.com/oauth2/publicAppAuthorize.htm?app_id=${appId}&scope=auth_user&redirect_uri=${redirectUri}`;
  }

  // Handle OAuth callback (code exchange)
  async function handleOAuthCallback(provider, code) {
    const deviceId = getDeviceId();
    const body = { device_id: deviceId };
    if (provider === "wechat") body.code = code;
    else if (provider === "google") body.code = code;
    else if (provider === "apple") body.code = code;
    else if (provider === "alipay") body.auth_code = code;

    const result = await authFetch(`/api/auth/${provider}/callback`, {
      method: "POST",
      body: JSON.stringify(body),
    });
    setToken(result.token);
    setUser(result);
    return result;
  }

  /* ──── Bind phone/email ──── */
  function bindPhone(phone) { return authFetch("/api/auth/bind-phone", { method: "POST", body: JSON.stringify({ phone }) }); }
  function bindEmail(email) { return authFetch("/api/auth/bind-email", { method: "POST", body: JSON.stringify({ email }) }); }
  function updateProfile(data) { return authFetch("/api/auth/profile", { method: "PUT", body: JSON.stringify(data) }); }

  /* ──── Bind third-party to existing account ──── */
  function bindOAuth(provider, providerUserId, providerData) {
    return authFetch("/api/auth/bind-oauth", { method: "POST", body: JSON.stringify({ provider, provider_user_id: providerUserId, provider_data: providerData }) });
  }

  /* ──── Replace the old externalSession system ──── */
  window.DaoxinAccount = {
    // Core
    autoRegister,
    getToken,
    getUser,
    setUser,
    getDeviceId,

    // OAuth login (priority order: third-party first)
    getOAuthProviders,
    wechatLogin,
    googleLogin,
    appleLogin,
    alipayLogin,
    handleOAuthCallback,

    // Binding
    bindPhone,
    bindEmail,
    bindOAuth,
    updateProfile,

    // For business API compatibility
    get user_id() { return getUser()?.user_id || ""; },
    get ready() { return Boolean(getToken()); },
    get has_phone() { return getUser()?.has_phone || false; },
    get has_email() { return getUser()?.has_email || false; },
    get bound_providers() { return getUser()?.bound_providers || []; },
  };

  // Override externalSession for backward compatibility
  window.DaoxinAuthBase = AUTH_BASE;

  // Auto-register on load
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => autoRegister());
  } else {
    autoRegister();
  }
})();
