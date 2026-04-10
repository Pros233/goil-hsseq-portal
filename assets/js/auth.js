/* ============================================================
   GOIL HSSEQ – Login  (Supabase Auth)
   ============================================================ */
(function () {
  'use strict';

  var SUPABASE_URL  = 'https://qpldcpendvdobtbkygxo.supabase.co';
  var SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFwbGRjcGVuZHZkb2J0Ymt5Z3hvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU1ODE3OTksImV4cCI6MjA5MTE1Nzc5OX0.MZJFtZO6pjwj_Ni1CpIjJTxaubprS79Kmf-lr1fkMYg';

  var db = null;

  // ── Supabase client ──────────────────────────────────────────────────────

  function getClient() {
    if (db) return db;
    if (window.supabase && window.supabase.createClient) {
      db = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON);
    }
    return db;
  }

  // ── UI helpers ──────────────────────────────────────────────────────────

  function setError(msg) {
    var el = document.getElementById('loginError');
    if (!el) return;
    el.textContent = msg || '';
    el.classList.toggle('show', !!msg);
  }

  function setLoading(isLoading) {
    var btn  = document.getElementById('loginBtn');
    var text = btn ? btn.querySelector('.btn-text') : null;
    if (!btn || !text) return;
    btn.disabled = isLoading;
    btn.classList.toggle('loading', isLoading);
    text.textContent = isLoading ? 'Signing in…' : 'Login';
  }

  function setPwLoading(isLoading) {
    var btn  = document.getElementById('pwChangeBtn');
    if (!btn) return;
    btn.disabled = isLoading;
    btn.textContent = isLoading ? 'Saving…' : 'Set New Password';
  }

  function setPwError(msg) {
    var el = document.getElementById('pwChangeError');
    if (!el) return;
    el.textContent = msg || '';
    el.classList.toggle('show', !!msg);
  }

  // ── Password visibility toggle ──────────────────────────────────────────

  function bindPasswordToggle(inputId, btnId) {
    var input = document.getElementById(inputId);
    var btn   = document.getElementById(btnId);
    if (!input || !btn) return;
    btn.addEventListener('click', function () {
      var hidden = input.type === 'password';
      input.type = hidden ? 'text' : 'password';
      btn.setAttribute('aria-pressed', hidden ? 'true' : 'false');
    });
  }

  // ── Already authenticated? Redirect ─────────────────────────────────────

  async function checkExistingSession() {
    // Handle password-recovery link (e.g. clicked from reset email)
    // Supabase puts #access_token=...&type=recovery in the URL hash
    if (window.location.hash.indexOf('type=recovery') >= 0) {
      var client = getClient();
      if (client) await client.auth.getSession(); // lets Supabase consume hash tokens
      // Update modal subtitle to "recovery" wording
      var sub = document.getElementById('pwModalSub');
      if (sub) sub.textContent = 'Enter and confirm your new password below.';
      showPasswordChangeModal();
      history.replaceState(null, '', window.location.pathname + window.location.search);
      return;
    }

    var client = getClient();
    if (!client) return;
    var res = await client.auth.getSession();
    if (res.data && res.data.session) {
      window.location.href = 'pages/portal.html';
    }
  }

  // ── Login ────────────────────────────────────────────────────────────────

  async function onLogin(event) {
    event.preventDefault();
    setError('');

    var email    = (document.getElementById('email').value    || '').trim().toLowerCase();
    var password = (document.getElementById('password').value || '').trim();

    if (!email || !password) {
      setError('Please enter your email and password.');
      return;
    }

    var client = getClient();
    if (!client) {
      setError('Unable to connect. Please refresh and try again.');
      return;
    }

    setLoading(true);

    var res = await client.auth.signInWithPassword({ email: email, password: password });

    if (res.error) {
      setLoading(false);
      setError('Invalid email or password. Please try again.');
      return;
    }

    var user = res.data.user;

    // Fetch profile for role + must_change_password
    var profileRes = await client
      .from('user_profiles')
      .select('full_name, office, role, must_change_password')
      .eq('id', user.id)
      .single();

    var profile = profileRes.data || {};

    // Save to localStorage for auth-guard fast-check
    localStorage.setItem('goilUserProfile', JSON.stringify({
      id:        user.id,
      email:     user.email,
      full_name: profile.full_name || user.email,
      office:    profile.office   || '',
      role:      profile.role     || 'submitter'
    }));

    // Handle "Keep me signed in"
    var keepEl = document.getElementById('keepSignedIn');
    var keep = !keepEl || keepEl.checked;
    if (!keep) {
      // Mark session as non-persistent so auth-guard can detect a fresh browser open
      localStorage.setItem('goilNoRemember', '1');
    } else {
      localStorage.removeItem('goilNoRemember');
    }
    // Mark this browser session as active (survives page nav, not browser close)
    sessionStorage.setItem('goilActive', '1');

    setLoading(false);

    // First-login password change
    if (profile.must_change_password) {
      showPasswordChangeModal();
      return;
    }

    window.location.href = 'pages/portal.html';
  }

  // ── First-login password change modal ────────────────────────────────────

  function showPasswordChangeModal() {
    var modal = document.getElementById('pwChangeModal');
    if (modal) modal.classList.add('open');
  }

  async function onPasswordChange(event) {
    event.preventDefault();
    setPwError('');

    var newPw     = (document.getElementById('pwNew').value     || '').trim();
    var confirmPw = (document.getElementById('pwConfirm').value || '').trim();

    if (newPw.length < 8) {
      setPwError('Password must be at least 8 characters.');
      return;
    }
    if (newPw !== confirmPw) {
      setPwError('Passwords do not match.');
      return;
    }
    if (newPw === 'Goilstaff1234') {
      setPwError('Please choose a different password from the default.');
      return;
    }

    var client = getClient();
    if (!client) return;

    setPwLoading(true);

    var updateRes = await client.auth.updateUser({ password: newPw });

    if (updateRes.error) {
      setPwLoading(false);
      setPwError('Failed to update password: ' + updateRes.error.message);
      return;
    }

    // Mark password as changed
    var profile = JSON.parse(localStorage.getItem('goilUserProfile') || '{}');
    await client
      .from('user_profiles')
      .update({ must_change_password: false })
      .eq('id', profile.id);

    setPwLoading(false);
    window.location.href = 'pages/portal.html';
  }

  // ── Forgot password ───────────────────────────────────────────────────────

  function showForgotModal() {
    var m = document.getElementById('forgotModal');
    if (!m) return;
    // Reset to step-1 state every time it opens
    var step1 = document.getElementById('forgotStep1');
    var step2 = document.getElementById('forgotStep2');
    if (step1) step1.style.display = '';
    if (step2) step2.style.display = 'none';
    var err = document.getElementById('forgotError');
    if (err) { err.textContent = ''; err.classList.remove('show'); }
    // Pre-fill email from login field
    var loginEmail = (document.getElementById('email') || {}).value || '';
    var fe = document.getElementById('forgotEmail');
    if (fe) { fe.value = loginEmail; }
    m.classList.add('open');
    if (fe) fe.focus();
  }

  function hideForgotModal() {
    var m = document.getElementById('forgotModal');
    if (m) m.classList.remove('open');
  }

  async function onForgotPassword(event) {
    event.preventDefault();

    var email   = (document.getElementById('forgotEmail').value || '').trim().toLowerCase();
    var btn     = document.getElementById('forgotSendBtn');
    var err     = document.getElementById('forgotError');

    if (err) { err.textContent = ''; err.classList.remove('show'); }

    if (!email) {
      if (err) { err.textContent = 'Please enter your email address.'; err.classList.add('show'); }
      return;
    }

    if (btn) { btn.disabled = true; btn.textContent = 'Sending…'; }

    var client = getClient();
    if (!client) {
      if (btn) { btn.disabled = false; btn.textContent = 'Send Reset Link'; }
      return;
    }

    var redirectTo = window.location.origin + window.location.pathname;
    await client.auth.resetPasswordForEmail(email, { redirectTo: redirectTo });
    // Always succeed (don't reveal whether email exists)

    if (btn) { btn.disabled = false; btn.textContent = 'Send Reset Link'; }

    // Show step 2 — instructions to check email
    var step1 = document.getElementById('forgotStep1');
    var step2 = document.getElementById('forgotStep2');
    if (step1) step1.style.display = 'none';
    if (step2) step2.style.display = '';
  }

  // ── Init ────────────────────────────────────────────────────────────────

  function init() {
    // Apply theme early
    var theme = localStorage.getItem('goilTheme') || 'dark';
    if (theme === 'light') document.documentElement.classList.add('light-mode');

    checkExistingSession();

    var form = document.getElementById('loginForm');
    if (form) form.addEventListener('submit', onLogin);

    var pwForm = document.getElementById('pwChangeForm');
    if (pwForm) pwForm.addEventListener('submit', onPasswordChange);

    var forgotForm = document.getElementById('forgotForm');
    if (forgotForm) forgotForm.addEventListener('submit', onForgotPassword);

    var forgotOpenBtn = document.getElementById('forgotPwBtn');
    if (forgotOpenBtn) forgotOpenBtn.addEventListener('click', showForgotModal);

    var forgotCancelBtn = document.getElementById('forgotCancelBtn');
    if (forgotCancelBtn) forgotCancelBtn.addEventListener('click', hideForgotModal);

    // Close modal if user clicks the dark backdrop
    var forgotOverlay = document.getElementById('forgotModal');
    if (forgotOverlay) {
      forgotOverlay.addEventListener('click', function (e) {
        if (e.target === forgotOverlay) hideForgotModal();
      });
    }

    bindPasswordToggle('password',   'togglePassword');
    bindPasswordToggle('pwNew',      'togglePwNew');
    bindPasswordToggle('pwConfirm',  'togglePwConfirm');
  }

  // Fix: scripts at end of <body> run after DOM is ready — don't wait for
  // DOMContentLoaded if it has already fired.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
