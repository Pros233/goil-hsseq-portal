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

    bindPasswordToggle('password',   'togglePassword');
    bindPasswordToggle('pwNew',      'togglePwNew');
    bindPasswordToggle('pwConfirm',  'togglePwConfirm');
  }

  document.addEventListener('DOMContentLoaded', init);
})();
