import { discordInvite, guildId } from './config.js';

const invite = /^https:\/\/(discord\.gg\/|discord\.com\/invite\/)[\w-]+\/?$/.test(discordInvite) ? discordInvite : '';
for (const link of document.querySelectorAll('[data-discord]')) {
  link.href = invite || `https://discord.com/channels/${guildId}`;
  if (invite) link.textContent = 'Join Discord';
}
for (const note of document.querySelectorAll('[data-invite-note]')) {
  if (invite) note.hidden = true;
}

const titles = [
  ['sinner-street-police-station','Sinner Street Police Station','Stations'],
  ['road-policing-unit','Road Policing Unit','Vehicles'],
  ['royal-crusade-hospital','Royal Crusade Hospital','Medical'],
  ['lewisham-police-station','Lewisham Police Station','Stations'],
  ['custody-vehicle-dock','Custody Vehicle Dock','Vehicles'],
  ['metropolitan-police-service','Metropolitan Police Service','Stations'],
  ['alperton-police-base','Alperton Police Base','Stations'],
  ['london-airport-police-station','London Airport Police Station','Stations'],
  ['sandy-shores-police-station','Sandy Shores Police Station','Stations'],
  ['paleto-bay-police-station','Paleto Bay Police Station','Stations'],
  ['central-traffic-garage','Central Traffic Garage','Vehicles'],
  ...[
    ['020803','2hs9fyVSeyVqOkmLNL5B'],['020728','v3YB7EIgUQtoFALD6agb'],
    ['020702','zXr65uzbtvFYI8OwskHh'],['020630','ZKfzaq9XxZpTvxk2g7ix'],
    ['020600','pHf6gCLlCGI1ow9arz9W'],['020522','a8oKH616Ro9pyRuUcZCP'],
    ['020353','o4v1sh2YlTW4kI5XM6uZ'],['020317','GpHOGVAzq9Na9RvgbxCv'],
    ['020238','ihEz62xFKcRoGNal88UZ'],['020140','yC7oUWoEWSMoRL1cXLFv']
  ].map(([id, original]) => [`station-${id}`,`Station screenshot ${id.match(/../g).join(':')}`,id === '020702' ? 'Medical' : 'Stations',original])
];

const grid = document.querySelector('#gallery-grid');
if (grid) {
  const dialog = document.querySelector('#photo-dialog');
  const more = document.querySelector('#gallery-more');
  const original = document.querySelector('#photo-original');
  let photos = titles;
  let limit = 6;
  let active = 0;
  let opener;
  function show(index) {
    active = (index + photos.length) % photos.length;
    const [id, title,, source] = photos[active];
    document.querySelector('#photo-title').textContent = title;
    const image = document.querySelector('#photo-full');
    image.src = `media/${id}.jpg`;
    image.alt = title;
    original.hidden = id === titles[0][0] || id === titles[3][0];
    original.href = source ? `https://kommodo.ai/i/${source}` : `https://westernline-screenshot-gallery.flutteringmixer2.chatgpt.site/images/${id}.png`;
    if (!dialog.open) dialog.showModal();
  }
  function render() {
    grid.replaceChildren(...photos.slice(0, limit).map(([id, title, category], index) => {
      const button = document.createElement('button');
      const img = document.createElement('img');
      const caption = document.createElement('span');
      const detail = document.createElement('small');
      button.className = 'media-card';
      button.type = 'button';
      img.src = `media/${id}.jpg`;
      img.alt = '';
      img.loading = 'lazy';
      caption.textContent = title;
      detail.textContent = category;
      button.append(img, caption, detail);
      button.addEventListener('click', () => { opener = button; show(index); });
      return button;
    }));
    more.hidden = limit >= photos.length;
  }
  for (const button of document.querySelectorAll('[data-filter]')) {
    button.addEventListener('click', () => {
      for (const option of document.querySelectorAll('[data-filter]')) option.setAttribute('aria-pressed', String(option === button));
      photos = button.dataset.filter === 'All' ? titles : titles.filter(item => item[2] === button.dataset.filter);
      limit = 6;
      render();
    });
  }
  more.addEventListener('click', () => { const firstNew = limit; limit += 6; render(); grid.children[firstNew]?.focus(); });
  document.querySelector('#photo-prev').addEventListener('click', () => show(active - 1));
  document.querySelector('#photo-next').addEventListener('click', () => show(active + 1));
  dialog.addEventListener('keydown', event => {
    if (event.key === 'ArrowLeft') show(active - 1);
    if (event.key === 'ArrowRight') show(active + 1);
  });
  dialog.addEventListener('close', () => opener?.focus());
  render();
}

document.querySelector('#copy')?.addEventListener('click', async event => {
  const button = event.currentTarget;
  const command = document.querySelector('.connect code');
  try {
    await navigator.clipboard.writeText(command.textContent);
    button.textContent = 'Copied';
    setTimeout(() => { button.textContent = 'Copy'; }, 1800);
  } catch {
    const range = document.createRange();
    range.selectNodeContents(command);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);
  }
});
