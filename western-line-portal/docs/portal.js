import { portalOrigin } from './config.js';

const element = id => document.getElementById(id);
const status = element('portal-status');
const signIn = element('sign-in');
const signInPending = element('sign-in-pending');
const signOut = element('sign-out');
const panels = element('member-panels');

function failMessage(code) {
  const descriptions = {
    not_member: 'Join The Western Line Discord server first, then try signing in again.',
    denied: 'Discord sign-in was cancelled. You can try again.',
    expired: 'Your Discord sign-in request expired. Please try again.',
    unavailable: 'Discord is temporarily unavailable. Try again in a moment.',
    pending: 'Complete the server’s Discord membership screening, then try again.'
  };
  return descriptions[code] || 'Sign in with Discord to continue.';
}

async function request(path, options) {
  const response = await fetch(path, {cache:'no-store', ...options});
  const data = await response.json();
  if (!response.ok) {
    const error = new Error(data.error || 'The portal could not complete the request.');
    error.status = response.status;
    error.code = data.code;
    throw error;
  }
  return data;
}

function post(path, data = {}) {
  return request(path, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(data)});
}

function populate(member) {
  const { user, roles, manageableRoles, applicationsEnabled } = member;
  element('member-name').textContent = user.displayName;
  element('member-handle').textContent = user.username;
  const avatar = element('avatar');
  avatar.hidden = !user.avatarUrl;
  if (user.avatarUrl) avatar.src = user.avatarUrl;
  const badges = roles.map(role => {
    const badge = document.createElement('li');
    badge.textContent = role.name;
    return badge;
  });
  element('role-list').replaceChildren(...badges);
  element('no-roles').hidden = badges.length !== 0;
  element('applications').hidden = !applicationsEnabled;
  element('role-management').hidden = !manageableRoles.length;
  const roleSelect = element('manageable-roles');
  const previousRole = roleSelect.value;
  roleSelect.replaceChildren(...manageableRoles.map(role => new Option(role.name, role.id)));
  if (manageableRoles.some(role => role.id === previousRole)) roleSelect.value = previousRole;
  panels.hidden = false;
  signIn.hidden = true;
  signInPending.hidden = true;
  signOut.hidden = false;
  status.textContent = 'Connected to The Western Line Discord.';
}

function showSignedOut(message) {
  panels.hidden = true;
  signOut.hidden = true;
  signInPending.hidden = true;
  signIn.hidden = false;
  status.textContent = message;
}

async function initialise() {
  const api = await request('api/status', { signal: AbortSignal.timeout(6000) }).catch(() => null);
  if (!api) {
    if (/^https:\/\/[^/?#]+\/?$/.test(portalOrigin)) {
      signIn.href = new URL('/auth/discord', portalOrigin).href;
      showSignedOut('Continue to Discord to sign in to the member portal.');
    } else {
      status.textContent = 'Discord sign-in is offline while the login service is being set up.';
    }
    return;
  }
  if (!api.configured) {
    status.textContent = 'Discord sign-in is offline while the login service is being set up.';
    return;
  }
  const auth = new URL(location.href).searchParams.get('auth');
  if (auth) history.replaceState(null, '', 'portal.html');
  try {
    populate(await request('api/me'));
  } catch (error) {
    showSignedOut(auth ? failMessage(auth) : error.status === 401 ? failMessage() : error.message);
  }
}

async function handleAction(control, feedback, action) {
  control.disabled = true;
  const idle = 'Working…';
  feedback.textContent = idle;
  try {
    await action();
  } catch (error) {
    if (error.status === 401 || error.code === 'not_member' || error.code === 'pending') {
      showSignedOut(error.message);
    } else {
      feedback.textContent = error.message;
    }
  } finally {
    control.disabled = false;
    if (feedback.textContent === idle) feedback.textContent = '';
  }
}
element('sync').addEventListener('click', event => {
  handleAction(event.currentTarget, element('sync-feedback'), async () => {
    populate(await request('api/me'));
    element('sync-feedback').textContent = 'Roles refreshed.';
  });
});
signOut.addEventListener('click', () => handleAction(signOut, status, async () => {
  await post('api/logout');
  document.querySelector('#application-form').reset();
  document.querySelector('#role-form').reset();
  showSignedOut('You’ve signed out.');
}));
element('application-form').addEventListener('submit', event => {
  event.preventDefault();
  const form = event.currentTarget;
  const data = Object.fromEntries(new FormData(form));
  const feedback = element('application-feedback');
  handleAction(event.submitter, feedback, async () => {
    const result = await post('api/applications', data);
    form.reset();
    feedback.textContent = result.message;
  });
});
element('role-form').addEventListener('submit', event => {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(event.currentTarget));
  const feedback = element('role-feedback');
  handleAction(event.submitter, feedback, async () => {
    const result = await post('api/roles', data);
    feedback.textContent = result.message;
  });
});

initialise();
