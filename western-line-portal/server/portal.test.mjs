import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { readConfig, guildId } from './config.mjs';
import { createHandler } from './index.mjs';

const leader = '703990442894688356';
const member = '123450000000000001';
const role = '123450000000000002';
const adminRole = '123450000000000003';
const channel = '123450000000000004';
const announcements = '123450000000000006';
const announcementId = '123450000000000007';
const origin = 'https://portal.example.test';
const config = readConfig({
  PUBLIC_ORIGIN:origin, DISCORD_CLIENT_ID:'123450000000000005', DISCORD_CLIENT_SECRET:'fake-secret',
  DISCORD_BOT_TOKEN:'fake-bot-test-token', SESSION_SECRET:'fake-session-key-for-integration-tests-only',
  MANAGEABLE_ROLE_IDS:`${role},${adminRole}`, APPLICATIONS_CHANNEL_ID:channel, ANNOUNCEMENTS_CHANNEL_ID:announcements
});

test('Render uses its public HTTPS URL and can boot before Discord is connected', () => {
  const env = {
    PORT:'10000',
    RENDER_EXTERNAL_URL:'https://twl-member-portal.onrender.com',
    SESSION_SECRET:'fake-session-key-for-integration-tests-only',
    DISCORD_CLIENT_ID:'123450000000000005'
  };
  const preview = readConfig(env);
  assert.equal(preview.configured,false);
  assert.equal(preview.port,10000);
  assert.equal(preview.secure,true);
  assert.equal(preview.redirectUri,'https://twl-member-portal.onrender.com/auth/callback');
  assert.equal(readConfig({...env, PUBLIC_ORIGIN:origin}).origin, origin);
  assert.throws(() => readConfig({...env, DISCORD_CLIENT_SECRET:'fake-secret'}), /Set DISCORD_CLIENT_ID/);
  assert.equal(readConfig({
    ...env, DISCORD_CLIENT_SECRET:'fake-secret', DISCORD_BOT_TOKEN:'fake-bot-test-token'
  }).configured,true);
});

test('Discord authentication, membership, applications and leadership-only role changes', async t => {
  const membership = new Map([[leader,{user:{username:'sean'},roles:[role]}],[member,{user:{username:'member'},roles:[]}]]);
  const mutations = [];
  const records = [];
  let isChannelPrivate = true;
  async function discordTestDouble(url, {method, body, headers}) {
    assert.equal(new URL(url).hostname, 'discord.com');
    assert.match(headers['User-Agent'], /^DiscordBot \(/);
    const requestUrl = new URL(url);
    const path = requestUrl.pathname.replace('/api/v10','');
    if (path === '/oauth2/token') {
      assert.equal(body.get('redirect_uri'), origin + '/auth/callback');
      return Response.json({access_token:body.get('code')});
    }
    if (path === '/users/@me') return Response.json({id:headers.Authorization.slice(7)});
    assert.equal(headers.Authorization, 'Bot fake-bot-test-token');
    const base = `/guilds/${guildId}`;
    if (path === base) return Response.json({owner_id:leader});
    if (path === base + '/roles') {
      return Response.json([
        {id:role,name:'MET Member',permissions:'0',position:2},
        {id:adminRole,name:'Admin',permissions:'8',position:3}
      ]);
    }
    const target = path.match(/\/members\/([0-9]+)(?:\/roles\/([0-9]+))?$/);
    if (target && method === 'GET') {
      return membership.has(target[1]) ? Response.json(membership.get(target[1])) : new Response(null,{status:404});
    }
    if (target && ['PUT','DELETE'].includes(method)) {
      mutations.push({path,method,headers});
      membership.get(target[1]).roles = method === 'PUT' ? [target[2]] : [];
      return new Response(null,{status:204});
    }
    if (path === `/channels/${channel}`) {
      return Response.json({id:channel,guild_id:guildId,type:0,
        permission_overwrites:[{id:guildId,type:0,allow:'0',deny:isChannelPrivate ? '1024' : '0'}]});
    }
    if (path === `/channels/${announcements}`) {
      return Response.json({id:announcements,guild_id:guildId,type:5,
        permission_overwrites:[{id:guildId,type:0,allow:'0',deny:'1024'}]});
    }
    if (path === `/channels/${announcements}/messages`) {
      assert.equal(requestUrl.searchParams.get('limit'),'12');
      return Response.json([{id:announcementId,type:0,content:'Server opening',timestamp:'2026-11-24T18:00:00Z'}]);
    }
    if (path === `/channels/${channel}/messages`) {
      if (method === 'GET') return Response.json(records);
      mutations.push({path,method,body:JSON.parse(body)});
      const record = {id:`1234500000000001${String(records.length).padStart(2,'0')}`,
        author:{id:config.clientId},timestamp:'2026-11-24T18:00:00Z',embeds:JSON.parse(body).embeds};
      records.push(record);
      return Response.json(record);
    }
    if (path.startsWith(`/channels/${channel}/messages/`)) {
      const record = records.find(item => path.endsWith('/'+item.id));
      if (!record) return new Response(null,{status:404});
      if (method === 'PATCH') record.embeds = JSON.parse(body).embeds;
      return Response.json(record);
    }
    assert.fail(`Unexpected Discord request: ${method} ${path}`);
  }
  const server = createServer(createHandler(config, discordTestDouble)).listen(0,'127.0.0.1');
  t.after(() => server.close());
  await once(server,'listening');
  const base = 'http://127.0.0.1:' + server.address().port;
  const get = (path,cookie) => fetch(base + path, {redirect:'manual',headers:cookie ? {Cookie:cookie} : {}});
  const post = (path,cookie,body,requestOrigin = origin) => fetch(base + path,{
    method:'POST',headers:{Cookie:cookie,Origin:requestOrigin,'Content-Type':'application/json'},body:JSON.stringify(body)
  });
  async function login(id, {validState = true} = {}) {
    const start = await get('/auth/discord');
    const auth = new URL(start.headers.get('Location'));
    assert.equal(auth.searchParams.get('scope'),'identify');
    const challenge = start.headers.get('Set-Cookie').split(';')[0];
    assert.match(start.headers.get('Set-Cookie'),/HttpOnly; SameSite=Lax; Max-Age=600; Secure/);
    const state = validState ? auth.searchParams.get('state') : 'forged';
    return get(`/auth/callback?code=${id}&state=${state}`,challenge);
  }
  function session(response) {
    assert.equal(response.headers.get('Location'),'/portal.html');
    const cookie = response.headers.getSetCookie().find(value => value.startsWith('__Host-twl_session='));
    assert.match(cookie,/HttpOnly; SameSite=Lax; Max-Age=28800; Secure/);
    return cookie.split(';')[0];
  }

  assert.equal((await get('/')).status,200);
  const dashboard = await get('/portal.html');
  assert.equal(dashboard.status,200);
  assert.match(await dashboard.text(), /class="portal-dashboard"/);
  const dashboardStyle = await get('/portal.css?v=2');
  assert.equal(dashboardStyle.status,200);
  assert.match(dashboardStyle.headers.get('Content-Type'), /^text\/css/);
  assert.equal((await get('/media/roundel.png')).status,200);
  assert.equal((await get('/.env')).status,404);
  assert.equal((await get('/api/me')).status,401);
  assert.equal((await login(leader,{validState:false})).headers.get('Location'),'/portal.html?auth=expired');
  assert.equal((await login('123450000000000099')).headers.get('Location'),'/portal.html?auth=not_member');

  const leaderSession = session(await login(leader));
  const memberSession = session(await login(member));
  const profile = await (await get('/api/me',leaderSession)).json();
  assert.deepEqual(profile.roles,[{id:role,name:'MET Member'}]);
  assert.deepEqual(profile.manageableRoles,profile.roles);
  assert.equal((await get('/api/me',leaderSession+'invalid')).status,401);
  const change = {userId:member,roleId:role,action:'add'};
  assert.equal((await post('/api/roles',memberSession,change)).status,403);
  assert.equal((await post('/api/roles',leaderSession,change,'https://other.example.test')).status,403);
  assert.equal((await post('/api/roles',leaderSession,{...change,roleId:adminRole})).status,403);
  assert.equal(mutations.length,0);
  assert.equal((await post('/api/roles',leaderSession,change)).status,200);
  assert.match(mutations[0].headers['X-Audit-Log-Reason'], new RegExp(leader));
  assert.deepEqual((await (await get('/api/me',memberSession)).json()).roles,profile.roles);
  assert.equal((await post('/api/roles',leaderSession,{...change,action:'remove'})).status,200);
  assert.deepEqual((await (await get('/api/me',memberSession)).json()).roles,[]);

  const application = {department:'LAS',message:'I would like to join for ambulance roleplay. @everyone'};
  isChannelPrivate = false;
  assert.equal((await post('/api/applications',memberSession,application)).status,503);
  isChannelPrivate = true;
  assert.equal((await post('/api/applications',memberSession,application)).status,200);
  assert.deepEqual(mutations[2].body.allowed_mentions,{parse:[]});
  assert.match(mutations[2].body.content,/London Ambulance Service/);
  assert.equal((await post('/api/applications',memberSession,application)).status,429);
  const support = {subject:'Trouble getting in',message:'Could someone help me connect to the FiveM server?'};
  assert.equal((await post('/api/tickets',memberSession,support)).status,200);
  assert.equal((await post('/api/tickets',leaderSession,support)).status,200);
  const own = await (await get('/api/tickets',memberSession)).json();
  assert.equal(own.records.length,1);
  assert.deepEqual(own.statuses,[]);
  const queue = await (await get('/api/tickets',leaderSession)).json();
  assert.equal(queue.records.length,2);
  const review = {id:own.records[0].id,status:'Closed'};
  assert.equal((await post('/api/tickets/review',memberSession,review)).status,403);
  assert.equal((await post('/api/applications/review',leaderSession,{...review,status:'Approved'})).status,404);
  assert.equal((await post('/api/tickets/review',leaderSession,review)).status,200);
  assert.equal((await (await get('/api/tickets',memberSession)).json()).records[0].status,'Closed');
  assert.equal((await get('/api/announcements',memberSession)).status,403);
  assert.equal((await (await get('/api/announcements',leaderSession)).json()).posts[0].text,'Server opening');

  membership.delete(member);
  assert.equal((await get('/api/me',memberSession)).status,403);
  const logout = await post('/api/logout',leaderSession,{});
  assert.match(logout.headers.get('Set-Cookie'),/Max-Age=0; Secure/);
});
