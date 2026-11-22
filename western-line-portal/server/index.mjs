import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { guildId, isSnowflake, leaders, openSeal, readConfig, seal } from './config.mjs';

const discordApi = 'https://discord.com/api/v10';
const guildPath = `/guilds/${guildId}`;
const departments = new Map([
  ['MET','Metropolitan Police Service'],['LAS','London Ambulance Service'],['LFB','London Fire Brigade']
]);
const mediaTypes = {'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.jpg':'image/jpeg','.png':'image/png'};
const publicFiles = new Set(['/index.html','/portal.html','/privacy.html','/config.js','/portal.js','/site.js','/style.css']);
// Never grant Discord roles carrying these guild-wide moderator or administration permissions.
const restrictedPermissions = [1,2,3,4,5,7,13,21,22,23,24,28,29,30,33,34,36,38,40,41,43,44,46,52].reduce((mask, bit) => mask | (1n << BigInt(bit)), 0n);

class HttpError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function reply(response, status, data) {
  response.writeHead(status, {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});
  response.end(JSON.stringify(data));
}

function redirect(response, target) {
  response.writeHead(302, {Location:target,'Cache-Control':'no-store'});
  response.end();
}

function cookieValue(request, name) {
  return (request.headers.cookie || '').split(';').map(item => item.trim()).find(item => item.startsWith(name + '='))?.slice(name.length + 1);
}

function setCookie(response, config, name, value, seconds) {
  const secure = config.secure ? '; Secure' : '';
  const existing = response.getHeader('Set-Cookie') || [];
  response.setHeader('Set-Cookie', [...existing, `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${seconds}${secure}`]);
}

async function jsonInput(request, config) {
  if (request.headers.origin !== config.origin) throw new HttpError(403, 'Open the member portal directly and try again.');
  if (request.headers['content-type']?.split(';')[0] !== 'application/json') throw new HttpError(415, 'Expected JSON.');
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 8192) throw new HttpError(413, 'This request is too large.');
    chunks.push(chunk);
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString());
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value;
  } catch {
    throw new HttpError(400, 'Invalid request.');
  }
}

async function serveStatic(request, response, pathname) {
  const path = pathname === '/' ? '/index.html' : pathname;
  if (!publicFiles.has(path) && !/^\/media\/[a-z0-9-]+\.(jpg|png)$/.test(path)) return false;
  if (!['GET','HEAD'].includes(request.method)) return false;
  try {
    const body = await readFile(new URL(`../docs${path}`, import.meta.url));
    response.writeHead(200, {'Content-Type':mediaTypes[extname(path)],'Content-Length':body.length,
      'Cache-Control':path.startsWith('/media/') ? 'public, max-age=86400' : 'no-cache'});
    response.end(request.method === 'HEAD' ? undefined : body);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

export function createHandler(config, fetchDiscord = fetch) {
  const sessionName = config.secure ? '__Host-twl_session' : 'twl_session';
  const stateName = config.secure ? '__Host-twl_state' : 'twl_state';
  const recentApplications = new Map();

  async function discord(path, options = {}) {
    const auth = options.bearer ? `Bearer ${options.bearer}` : `Bot ${config.botToken}`;
    let response;
    try {
      response = await fetchDiscord(discordApi + path, {
        method:options.method || 'GET',
        headers:{ Authorization:auth, 'Content-Type':'application/json', ...options.headers },
        body: options.body ? JSON.stringify(options.body) : undefined,
        signal:AbortSignal.timeout(9000)
      });
    } catch {
      throw new HttpError(502, 'Discord is temporarily unavailable.', 'unavailable');
    }
    if (response.status === 404) return null;
    if (response.status === 429) throw new HttpError(503, 'Discord is receiving too many requests. Try again shortly.', 'unavailable');
    if (response.status === 403) throw new HttpError(502, 'Discord denied the bot operation. Check its permissions and role order.', 'unavailable');
    if (!response.ok) throw new HttpError(502, 'Discord could not complete the request.', 'unavailable');
    if (response.status === 204) return true;
    return response.json();
  }

  async function memberById(id) {
    const member = await discord(`${guildPath}/members/${id}`);
    if (!member) throw new HttpError(403, 'Join The Western Line Discord server first.', 'not_member');
    if (member.pending) throw new HttpError(403, 'Complete the membership screening in Discord first.', 'pending');
    return member;
  }

  async function authenticate(request) {
    const session = openSeal(config.sessionSecret, cookieValue(request, sessionName));
    if (session?.type !== 'session' || !isSnowflake(session.userId)) throw new HttpError(401, 'Sign in with Discord to continue.');
    const member = await memberById(session.userId);
    return { id:session.userId, member, leadership:leaders.has(session.userId) };
  }

  function mayManage(role) {
    return role && role.id !== guildId && config.roleIds.has(role.id) && !role.managed
      && (BigInt(role.permissions) & restrictedPermissions) === 0n;
  }

  function begin(response) {
    const state = randomBytes(32).toString('base64url');
    setCookie(response, config, stateName, seal(config.sessionSecret, {type:'state', state, expires:Date.now()+600000}), 600);
    const oauth = new URL('https://discord.com/oauth2/authorize');
    oauth.search = new URLSearchParams({client_id:config.clientId,redirect_uri:config.redirectUri,
      response_type:'code',scope:'identify',state});
    redirect(response, oauth.href);
  }

  async function callback(request, response, search) {
    const challenge = openSeal(config.sessionSecret, cookieValue(request, stateName));
    setCookie(response, config, stateName, '', 0);
    if (challenge?.type !== 'state' || challenge.state !== search.get('state')) return redirect(response, '/portal.html?auth=expired');
    if (search.has('error') || !search.get('code')) return redirect(response, '/portal.html?auth=denied');
    try {
      const tokens = await fetchDiscord(discordApi + '/oauth2/token', {
        method:'POST', headers:{'Content-Type':'application/x-www-form-urlencoded'},
        body:new URLSearchParams({client_id:config.clientId,client_secret:config.clientSecret,grant_type:'authorization_code',
          code:search.get('code'),redirect_uri:config.redirectUri}), signal:AbortSignal.timeout(9000)
      });
      if (!tokens.ok) return redirect(response, '/portal.html?auth=denied');
      const {access_token: accessToken} = await tokens.json();
      if (!accessToken) return redirect(response, '/portal.html?auth=denied');
      const user = await discord('/users/@me',{bearer:accessToken});
      if (!isSnowflake(user?.id)) return redirect(response, '/portal.html?auth=denied');
      await memberById(user.id);
      const maxAge = 8 * 60 * 60;
      setCookie(response, config, sessionName, seal(config.sessionSecret, {type:'session',userId:user.id,expires:Date.now()+maxAge*1000}), maxAge);
      return redirect(response, '/portal.html');
    } catch (error) {
      return redirect(response, '/portal.html?auth=' + (['not_member','pending'].includes(error.code) ? error.code : 'unavailable'));
    }
  }

  async function profile(auth) {
    const roles = await discord(`${guildPath}/roles`);
    if (!Array.isArray(roles) || !auth.member.user) throw new HttpError(502, 'Could not read Discord roles.');
    roles.sort((a,b) => b.position - a.position);
    const {user, nick} = auth.member;
    const present = ({id,name}) => ({id,name});
    return {
      user:{ username:user.username, displayName:nick || user.global_name || user.username,
        avatarUrl:user.avatar && /^[a-z0-9_]+$/i.test(user.avatar) ? `https://cdn.discordapp.com/avatars/${auth.id}/${user.avatar}.webp?size=96` : null },
      roles:roles.filter(role => auth.member.roles.includes(role.id) && role.id !== guildId).map(present),
      manageableRoles:auth.leadership ? roles.filter(mayManage).map(present) : [],
      applicationsEnabled:Boolean(config.applicationsChannel)
    };
  }

  async function apply(auth, data) {
    const dept = departments.get(data.department);
    const message = typeof data.message === 'string' ? data.message.trim() : '';
    if (!config.applicationsChannel) throw new HttpError(404, 'Applications are not open through the portal.');
    if (!dept || message.length < 30 || message.length > 1000) throw new HttpError(400, 'Select a department and write 30 to 1,000 characters.');
    const channel = await discord(`/channels/${config.applicationsChannel}`);
    const everyone = channel?.permission_overwrites?.find(overwrite => overwrite.id === guildId && overwrite.type === 0);
    const viewChannel = 1n << 10n;
    const privateChannel = everyone && (BigInt(everyone.deny) & viewChannel) !== 0n && (BigInt(everyone.allow) & viewChannel) === 0n;
    if (!channel || channel.guild_id !== guildId || channel.type !== 0 || !privateChannel) {
      throw new HttpError(503, 'The private application channel is awaiting configuration.');
    }
    const now = Date.now();
    for (const [id, until] of recentApplications) if (until <= now) recentApplications.delete(id);
    if (recentApplications.has(auth.id)) throw new HttpError(429, 'Please wait a minute before sending another application.');
    recentApplications.set(auth.id, now + 60000);
    try {
      const sanitized = message.replace(/[`*_~|>]/g, char => '\\' + char);
      const result = await discord(`/channels/${config.applicationsChannel}/messages`, {
        method:'POST', body:{ allowed_mentions:{ parse:[] }, content:`**New portal application**\nDepartment: ${dept}\nApplicant Discord ID: ${auth.id}`,
          embeds:[{description:sanitized}] }
      });
      if (!result) throw new HttpError(502, 'Could not deliver the application.');
    } catch (error) {
      recentApplications.delete(auth.id);
      throw error;
    }
    return {message:'Application sent to the review team in Discord.'};
  }

  async function changeRole(auth, data) {
    if (!auth.leadership) throw new HttpError(403, 'Only Western Line leadership can manage roles here.');
    if (!isSnowflake(data.userId) || !isSnowflake(data.roleId) || !['add','remove'].includes(data.action)) {
      throw new HttpError(400, 'Enter a Discord user ID and select a role and action.');
    }
    const roles = await discord(`${guildPath}/roles`);
    const role = roles?.find(item => item.id === data.roleId);
    if (!mayManage(role)) throw new HttpError(403, 'This role is not approved for portal management.');
    await memberById(data.userId);
    const result = await discord(`${guildPath}/members/${data.userId}/roles/${data.roleId}`, {
      method:data.action === 'add' ? 'PUT' : 'DELETE',
      headers:{'X-Audit-Log-Reason':encodeURIComponent(`Western Line portal: ${auth.id} requested ${data.action}`)}
    });
    if (!result) throw new HttpError(404, 'Discord could not find that member or role.');
    return {message:data.action === 'add' ? 'Role added in Discord.' : 'Role removed in Discord.'};
  }

  return async (request, response) => {
    response.setHeader('X-Content-Type-Options','nosniff');
    response.setHeader('Referrer-Policy','no-referrer');
    response.setHeader('X-Frame-Options','DENY');
    response.setHeader('Content-Security-Policy',"default-src 'self'; img-src 'self' https://cdn.discordapp.com; style-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    if (config.secure) response.setHeader('Strict-Transport-Security','max-age=31536000');
    try {
      const url = new URL(request.url, config.origin);
      const {pathname, searchParams} = url;
      if (await serveStatic(request,response,pathname)) return;
      if (request.method === 'GET' && pathname === '/api/status') return reply(response,200,{configured:config.configured});
      if (!pathname.startsWith('/api/') && !pathname.startsWith('/auth/')) return reply(response,404,{error:'Page not found.'});
      if (!config.configured) return reply(response,503,{error:'Discord sign-in is awaiting configuration.'});
      if (request.method === 'GET' && pathname === '/auth/discord') return begin(response);
      if (request.method === 'GET' && pathname === '/auth/callback') return callback(request,response,searchParams);
      if (request.method === 'POST' && pathname === '/api/logout') {
        await jsonInput(request,config);
        setCookie(response,config,sessionName,'',0);
        return reply(response,200,{signedOut:true});
      }
      if (request.method === 'GET' && pathname === '/api/me') return reply(response,200,await profile(await authenticate(request)));
      if (request.method === 'POST' && ['/api/applications','/api/roles'].includes(pathname)) {
        const data = await jsonInput(request,config);
        const auth = await authenticate(request);
        const result = pathname === '/api/applications' ? await apply(auth,data) : await changeRole(auth,data);
        return reply(response,200,result);
      }
      return reply(response,404,{error:'Page not found.'});
    } catch (error) {
      if (error instanceof HttpError) return reply(response,error.status,{error:error.message,code:error.code});
      console.error('Portal request failed', error.name);
      return reply(response,500,{error:'The portal could not complete the request.'});
    }
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url).toLowerCase() === process.argv[1].toLowerCase()) {
  const config = readConfig(process.env);
  createServer({requestTimeout:20000},createHandler(config)).listen(config.port,process.env.HOST || '127.0.0.1',() => {
    console.log(`The Western Line is listening at ${config.origin}`);
  });
}
