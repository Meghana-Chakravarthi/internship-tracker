const authForm = document.getElementById('auth-form');
const usernameInput = document.getElementById('username');
const passwordInput = document.getElementById('password');
const submitButton = document.getElementById('submit-button');
const message = document.getElementById('auth-message');
const title = document.getElementById('auth-title');
const description = document.getElementById('auth-description');
const passwordHint = document.getElementById('password-hint');
const loginTab = document.getElementById('login-tab');
const registerTab = document.getElementById('register-tab');

let mode = 'login';

function setMode(nextMode) {
  mode = nextMode;
  const registering = mode === 'register';
  title.textContent = registering ? 'Create your account' : 'Welcome back';
  description.textContent = registering
    ? 'Set up a private space to manage your applications.'
    : 'Sign in to continue to your application tracker.';
  submitButton.textContent = registering ? 'Create account' : 'Sign in';
  passwordInput.autocomplete = registering ? 'new-password' : 'current-password';
  passwordInput.minLength = registering ? 10 : 1;
  passwordHint.hidden = !registering;
  loginTab.classList.toggle('active', !registering);
  registerTab.classList.toggle('active', registering);
  loginTab.setAttribute('aria-selected', String(!registering));
  registerTab.setAttribute('aria-selected', String(registering));
  message.className = 'flash auth-message';
  message.textContent = '';
}

loginTab.addEventListener('click', () => setMode('login'));
registerTab.addEventListener('click', () => setMode('register'));

authForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  submitButton.disabled = true;
  submitButton.textContent = mode === 'register' ? 'Creating account…' : 'Signing in…';
  message.textContent = '';
  message.className = 'flash auth-message';

  try {
    const response = await fetch(`/api/auth/${mode === 'register' ? 'register' : 'login'}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: usernameInput.value.trim(),
        password: passwordInput.value
      })
    });
    const result = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(result?.error || 'Unable to sign in. Please try again.');
    }
    window.location.assign('/');
  } catch (error) {
    message.textContent = error.message;
    message.classList.add('error');
    submitButton.disabled = false;
    submitButton.textContent = mode === 'register' ? 'Create account' : 'Sign in';
  }
});
