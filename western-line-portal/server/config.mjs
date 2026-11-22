import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const guildId = '1566132871163412581';
export const leaders = new Set(['723343308872744990','703990442894688356','281562943928139776']);
export const isSnowflake = value => typeof value === 'string' && /^[0-9]{17,20}$/.test(value);

export function readConfig(env) {
  const port = Number(env.PORT || 8787);
  const origin = new URL(env.PUBLIC_ORIGIN || `http://localhost:${port}`);
  const development = origin.protocol === 'http:' && ['localhost','127.0.0.1'].includes(origin.hostname);
  if (origin.href !== origin.origin + '/' || (!development && origin.protocol !== 'https:')) {
    throw new Error('PUBLIC_ORIGIN must be an HTTPS origin, or HTTP localhost for development.');
  }
  const { DISCORD_CLIENT_ID: clientId, DISCORD_CLIENT_SECRET: clientSecret,
    DISCORD_BOT_TOKEN: botToken, SESSION_SECRET: sessionSecret, APPLICATIONS_CHANNEL_ID: applicationsChannel } = env;
  const configured = Boolean(clientId || clientSecret || botToken || sessionSecret);
  if (configured && (!isSnowflake(clientId) || !clientSecret || !botToken || !sessionSecret || Buffer.byteLength(sessionSecret) < 32)) {
    throw new Error('Set DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET, DISCORD_BOT_TOKEN and a SESSION_SECRET of at least 32 bytes.');
  }
  const roleIds = (env.MANAGEABLE_ROLE_IDS || '').split(',').map(id => id.trim()).filter(Boolean);
  if (roleIds.some(id => !isSnowflake(id) || id === guildId) || (applicationsChannel && !isSnowflake(applicationsChannel))) {
    throw new Error('Check your Discord role IDs and applications channel ID.');
  }
  return {
    configured, port, origin: origin.origin, secure: !development, clientId, clientSecret, botToken,
    sessionSecret: sessionSecret || randomBytes(32), roleIds: new Set(roleIds), applicationsChannel,
    redirectUri: new URL('/auth/callback', origin).href
  };
}

function signature(secret, body) {
  return createHmac('sha256', secret).update(body).digest('base64url');
}

export function seal(secret, payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return body + '.' + signature(secret, body);
}

export function openSeal(secret, value) {
  const [body, signed, extra] = (value || '').split('.');
  if (!body || !signed || extra !== undefined) return null;
  const expected = Buffer.from(signature(secret, body));
  const provided = Buffer.from(signed);
  if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) return null;
  try {
    const data = JSON.parse(Buffer.from(body, 'base64url'));
    return data.expires > Date.now() ? data : null;
  } catch {
    return null;
  }
}
