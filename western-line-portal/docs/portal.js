import { portalOrigin } from './config.js';

const element = id => document.getElementById(id);
const status = element('portal-status');
const signIn = element('sign-in');
const signInPending = element('sign-in-pending');
const signOut = element('sign-out');
const sessionLabel = element('session-label');
const roleSearch = element('role-search');
const navigation = [...document.querySelectorAll('[data-view]')];
let currentView = 'overview';
let memberRoles = [];
let sessionVersion = 0;

function failMessage(code) {
  const descriptions = {
    not_member: 'Join The Western Line on Discord, then try signing in again.',
    denied: 'Discord sign-in was cancelled. You can try again.',
    expired: 'Your Discord sign-in request expired. Please try again.',
    unavailable: 'Discord is temporarily unavailable. Try again in a moment.',
    pending: 'Complete the Discord membership screening, then try again.'
  };
  return descriptions[code] || 'Use your Discord account to sign in.';
}

async function request(path, options) {
  const response = await fetch(path, { cache: 'no-store', ...options });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data) {
    const error = new Error(data?.error || 'The portal could not complete the request. Try again in a moment.');
    error.status = response.status;
    error.code = data?.code;
    throw error;
  }
  return data;
}

function post(path, data = {}) {
  return request(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
}

function showView(requested = location.hash.slice(1), moveFocus = false) {
  const selected = navigation.find(link => link.dataset.view === requested && !link.hidden) || navigation[0];
  const previous = currentView;
  currentView = selected.dataset.view;
  for (const link of navigation) {
    element(link.dataset.view).hidden = link !== selected;
    if (link === selected) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
  element('current-view').textContent = selected.textContent;
  if (moveFocus && previous !== currentView) {
    element('main').focus();
    window.scrollTo(0, 0);
  }
}

function renderRoles() {
  const query = roleSearch.value.trim().toLocaleLowerCase('en-GB');
  const matches = memberRoles.filter(role => role.name.toLocaleLowerCase('en-GB').includes(query));
  const rows = matches.map(role => {
    const row = document.createElement('li');
    row.textContent = role.name;
    return row;
  });
  element('role-list').replaceChildren(...rows);
  const total = memberRoles.length;
  element('role-count').textContent = query && matches.length !== total
    ? `${matches.length} of ${total} roles`
    : `${total} ${total === 1 ? 'role' : 'roles'}`;
  element('role-search-label').hidden = total === 0;
  element('no-roles').hidden = total !== 0;
  element('no-matching-roles').hidden = total === 0 || matches.length !== 0;
}

function populate(member) {
  const { user, roles, manageableRoles, applicationsEnabled } = member;
  memberRoles = roles;
  renderRoles();

  element('member-name').textContent = user.displayName;
  element('member-handle').textContent = user.username;
  element('avatar').src = user.avatarUrl || 'media/roundel.png';
  element('welcome-title').textContent = `Welcome, ${user.displayName}`;
  element('welcome-subtitle').textContent = 'Check your profile, browse departments and join the server.';
  sessionLabel.textContent = user.displayName;

  const roleSelect = element('manageable-roles');
  const previousRole = roleSelect.value;
  roleSelect.replaceChildren(...manageableRoles.map(role => new Option(role.name, role.id)));
  if (manageableRoles.some(role => role.id === previousRole)) roleSelect.value = previousRole;

  const available = new Set(['overview', 'profile']);
  if (applicationsEnabled) available.add('applications');
  if (manageableRoles.length) available.add('role-management');
  for (const link of navigation) link.hidden = !available.has(link.dataset.view);
  element('guest-sign-in').hidden = true;
  element('overview-account').hidden = false;
  signOut.hidden = false;
  showView();
}

function showSignedOut(message) {
  sessionVersion += 1;
  memberRoles = [];
  roleSearch.value = '';
  renderRoles();
  element('member-name').textContent = '';
  element('member-handle').textContent = '';
  element('avatar').src = 'media/roundel.png';
  element('manageable-roles').replaceChildren();
  element('welcome-title').textContent = 'Member portal';
  element('welcome-subtitle').textContent = 'Your account and departments for London FiveM roleplay.';
  for (const link of navigation) link.hidden = link.dataset.view !== 'overview';
  element('guest-sign-in').hidden = false;
  element('overview-account').hidden = true;
  sessionLabel.textContent = 'Guest';
  signOut.hidden = true;
  signInPending.hidden = true;
  signIn.hidden = false;
  status.textContent = message;
  showView();
}

async function initialise() {
  const api = await request('api/status', { signal: AbortSignal.timeout(6000) }).catch(() => null);
  if (!api) {
    if (/^https:\/\/[^/?#]+\/?$/.test(portalOrigin)) {
      signIn.href = new URL('/auth/discord', portalOrigin).href;
      showSignedOut('Use your Discord account to sign in.');
    } else {
      status.textContent = 'Discord sign-in is temporarily unavailable.';
    }
    return;
  }
  if (!api.configured) {
    status.textContent = 'Discord sign-in is temporarily unavailable.';
    return;
  }
  const url = new URL(location.href);
  const auth = url.searchParams.get('auth');
  if (auth) {
    url.searchParams.delete('auth');
    history.replaceState(null, '', url);
  }
  try {
    populate(await request('api/me', { signal: AbortSignal.timeout(24000) }));
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

window.addEventListener('hashchange', () => {
  if (location.hash !== '#main') showView(location.hash.slice(1), true);
});
roleSearch.addEventListener('input', renderRoles);
element('sync').addEventListener('click', event => {
  handleAction(event.currentTarget, element('sync-feedback'), async () => {
    const version = sessionVersion;
    const member = await request('api/me', { signal: AbortSignal.timeout(24000) });
    if (version !== sessionVersion) return;
    populate(member);
    element('sync-feedback').textContent = 'Roles refreshed.';
  });
});
signOut.addEventListener('click', async () => {
  signOut.disabled = true;
  sessionVersion += 1;
  try {
    await post('api/logout');
    element('application-form').reset();
    element('role-form').reset();
    for (const id of ['sync-feedback','application-feedback','role-feedback']) element(id).textContent = '';
    showSignedOut('You’ve signed out.');
    signIn.focus();
  } catch {
    sessionLabel.textContent = 'Sign-out failed. Try again.';
  } finally {
    signOut.disabled = false;
  }
});
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
