(function () {
  "use strict";

  var AUTH_KEY = "goilAuth";
  var USER_KEY = "goilUser";

  function saveToStorage(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  function loadFromStorage(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (error) {
      return fallback;
    }
  }

  function isAuthenticated() {
    var auth = loadFromStorage(AUTH_KEY, null);
    return Boolean(auth && auth.authenticated === true);
  }

  function validateDemoCredentials(email, password) {
    if (!email || !password) return false;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return false;
    if (password.length < 4) return false;
    return true;
  }

  function setLoginError(message) {
    var errorNode = document.getElementById("loginError");
    if (!errorNode) return;
    if (!message) {
      errorNode.textContent = "";
      errorNode.classList.remove("show");
      return;
    }
    errorNode.textContent = message;
    errorNode.classList.add("show");
  }

  function setLoadingState(isLoading) {
    var btn = document.getElementById("loginBtn");
    var btnText = btn ? btn.querySelector(".btn-text") : null;
    if (!btn || !btnText) return;

    if (isLoading) {
      btn.disabled = true;
      btn.classList.add("loading");
      btnText.textContent = "Signing in…";
      return;
    }

    btn.disabled = false;
    btn.classList.remove("loading");
    btnText.textContent = "Login";
  }

  function togglePasswordVisibility() {
    var passwordField = document.getElementById("password");
    var toggleBtn = document.getElementById("togglePassword");
    if (!passwordField || !toggleBtn) return;

    var isHidden = passwordField.type === "password";
    passwordField.type = isHidden ? "text" : "password";
    toggleBtn.setAttribute("aria-pressed", isHidden ? "true" : "false");
    toggleBtn.setAttribute("aria-label", isHidden ? "Hide password" : "Show password");
  }

  function onLogin(event) {
    event.preventDefault();

    var form = event.currentTarget;
    var email = form.email.value.trim().toLowerCase();
    var password = form.password.value.trim();
    setLoginError("");

    if (!validateDemoCredentials(email, password)) {
      setLoginError("Invalid credentials. Please try again.");
      return;
    }

    setLoadingState(true);

    window.setTimeout(function () {
      saveToStorage(AUTH_KEY, {
        authenticated: true,
        loginAt: new Date().toISOString(),
        authMode: "frontend-demo"
      });

      saveToStorage(USER_KEY, {
        email: email,
        username: email
      });

      window.location.href = "pages/portal.html?email=" + encodeURIComponent(email) + "&v=20260318-masterrefdeep6";
    }, 650);
  }

  function init() {
    if (isAuthenticated()) {
      window.location.href = "pages/portal.html?v=20260318-masterrefdeep6";
      return;
    }

    var form = document.getElementById("loginForm");
    if (form) {
      form.addEventListener("submit", onLogin);
    }

    var toggleBtn = document.getElementById("togglePassword");
    if (toggleBtn) {
      toggleBtn.addEventListener("click", togglePasswordVisibility);
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();
