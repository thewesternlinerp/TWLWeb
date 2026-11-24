import { guildId, isSnowflake, leaders } from './config.mjs';

const guildPath = `/guilds/${guildId}`;
const viewChannel = 1n << 10n;
const readHistory = 1n << 16n;
const administrator = 1n << 3n;

const departments = new Map([
  ['MET', 'Metropolitan Police Service'], ['LAS', 'London Ambulance Service'], ['LFB', 'London Fire Brigade']
]);
const requestTypes = {
  applications: { label: 'application', statuses: ['Submitted', 'Under review', 'Approved', 'Declined'] },
  tickets: { label: 'support request', statuses: ['Open', 'In progress', 'Closed'] }
};

export function canReadChannel(auth, guild, roles, channel) {
  if (auth.id === guild.owner_id) return true;

  const memberRoles = new Set(auth.member.roles);
  let permissions = roles.filter(role => role.id === guildId || memberRoles.has(role.id))
    .reduce((flags, role) => flags | BigInt(role.permissions), 0n);
  if (permissions & administrator) return true;

  const overwrites = channel.permission_overwrites || [];
  const everyone = overwrites.find(item => item.type === 0 && item.id === guildId);
  if (everyone) permissions = (permissions & ~BigInt(everyone.deny)) | BigInt(everyone.allow);

  let allowed = 0n;
  let denied = 0n;
  for (const item of overwrites) {
    if (item.type === 0 && memberRoles.has(item.id)) {
      allowed |= BigInt(item.allow);
      denied |= BigInt(item.deny);
    }
  }
  permissions = (permissions & ~denied) | allowed;
  const member = overwrites.find(item => item.type === 1 && item.id === auth.id);
  if (member) permissions = (permissions & ~BigInt(member.deny)) | BigInt(member.allow);
  return (permissions & (viewChannel | readHistory)) === (viewChannel | readHistory);
}

export function createCommunity(config, discord, HttpError) {
  const cooldown = new Map();

  async function reviewChannel() {
    if (!config.applicationsChannel) throw new HttpError(404, 'Portal submissions are not open.');
    const channel = await discord(`/channels/${config.applicationsChannel}`);
    const overwrites = channel?.permission_overwrites || [];
    const everyone = overwrites.find(item => item.type === 0 && item.id === guildId);
    const leakedAccess = overwrites.some(item => (BigInt(item.allow) & viewChannel)
      && !(item.type === 1 && (leaders.has(item.id) || item.id === config.clientId)));
    if (channel?.guild_id !== guildId || channel.type !== 0 || !everyone || !(BigInt(everyone.deny) & viewChannel) || leakedAccess) {
      throw new HttpError(503, 'The private review channel is unavailable.');
    }
    return `/channels/${channel.id}/messages`;
  }

  function recordFrom(message, kind) {
    if (message?.author?.id !== config.clientId || !isSnowflake(message.id)) return null;
    const embed = message.embeds?.[0];
    const prefix = `Western Line portal | ${kind} | `;
    const marker = embed?.footer?.text;
    const requester = typeof marker === 'string' && marker.startsWith(prefix) ? marker.slice(prefix.length) : '';
    const status = embed?.fields?.find(field => field.name === 'Status')?.value;
    if (!isSnowflake(requester) || !requestTypes[kind].statuses.includes(status)) return null;
    return { id: message.id, subject: embed.title, detail: embed.description, status, requester, date: message.timestamp };
  }

  async function submit(auth, kind, data) {
    const { label, statuses } = requestTypes[kind];
    const detail = typeof data.message === 'string' ? data.message.trim() : '';
    const subject = kind === 'applications' ? departments.get(data.department)
      : typeof data.subject === 'string' ? data.subject.trim() : '';
    if (!subject || subject.length < 5 || subject.length > 90 || detail.length < 30 || detail.length > 1000) {
      throw new HttpError(400, 'Select a department or enter a subject, and write 30 to 1,000 characters.');
    }
    const path = await reviewChannel();
    const now = Date.now();
    const key = `${kind}:${auth.id}`;
    for (const [id, until] of cooldown) if (until <= now) cooldown.delete(id);
    if (cooldown.has(key)) throw new HttpError(429, `Please wait a minute before sending another ${label}.`);
    cooldown.set(key, now + 60000);
    const clean = detail.replace(/[`*_~|>]/g, char => '\\' + char);
    try {
      const message = await discord(path, {
        method: 'POST',
        body: {
          allowed_mentions: { parse: [] },
          content: `**Western Line portal ${label}**\n${kind === 'applications' ? 'Department: ' + subject + '\n' : ''}Requester Discord ID: ${auth.id}`,
          embeds: [{
            title: subject, description: clean, fields: [{name:'Status',value:statuses[0]}],
            footer: {text:`Western Line portal | ${kind} | ${auth.id}`}
          }]
        }
      });
      if (!message) throw new HttpError(502, `Could not deliver the ${label}.`);
    } catch (error) {
      cooldown.delete(key);
      throw error;
    }
    return {message:`${label[0].toUpperCase() + label.slice(1)} sent to the review team in Discord.`};
  }

  async function list(auth, kind) {
    const path = await reviewChannel();
    const messages = await discord(`${path}?limit=100`);
    if (!Array.isArray(messages)) throw new HttpError(502, 'Could not read the review queue.');
    return {
      records: messages.map(message => recordFrom(message, kind)).filter(record => record && (record.requester === auth.id || auth.leadership)),
      statuses: auth.leadership ? requestTypes[kind].statuses : []
    };
  }

  async function review(auth, kind, data) {
    if (!auth.leadership) throw new HttpError(403, 'Only Western Line leadership can review submissions.');
    if (!isSnowflake(data.id) || !requestTypes[kind].statuses.includes(data.status)) {
      throw new HttpError(400, 'Select a valid request and status.');
    }
    const path = `${await reviewChannel()}/${data.id}`;
    const message = await discord(path);
    if (!recordFrom(message, kind)) throw new HttpError(404, 'This portal request could not be found.');
    const { title, description, footer } = message.embeds[0];
    const updated = await discord(path, {
      method: 'PATCH',
      body: {embeds:[{title,description,footer:{text:footer.text},fields:[{name:'Status',value:data.status}]}],allowed_mentions:{parse:[]}}
    });
    if (!updated) throw new HttpError(404, 'This portal request could not be found.');
    return {message:'Status updated.'};
  }

  async function announcements(auth) {
    if (!config.announcementsChannel) throw new HttpError(404, 'Announcements are not enabled.');
    const [guild, roles, channel] = await Promise.all([
      discord(guildPath), discord(`${guildPath}/roles`), discord(`/channels/${config.announcementsChannel}`)
    ]);
    if (!guild || !Array.isArray(roles) || channel?.guild_id !== guildId || ![0,5].includes(channel.type)) {
      throw new HttpError(503, 'The announcements channel is unavailable.');
    }
    if (!canReadChannel(auth, guild, roles, channel)) {
      throw new HttpError(403, 'Your Discord account needs access to the announcements channel.');
    }
    const messages = await discord(`/channels/${channel.id}/messages?limit=12`);
    if (!Array.isArray(messages)) throw new HttpError(502, 'Could not read Discord announcements.');
    return { posts:messages.filter(message => isSnowflake(message.id) && [0,19].includes(message.type)).map(message => ({
      id:message.id,
      text:[message.content,...(message.embeds || []).flatMap(embed=>[embed.title,embed.description])].filter(Boolean).join('\n').slice(0,2500),
      date:message.timestamp,
      url:`https://discord.com/channels/${guildId}/${channel.id}/${message.id}`
    })) };
  }

  return {submit, list, review, announcements};
}
