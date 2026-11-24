import { createHash, timingSafeEqual } from 'node:crypto';
import { isSnowflake } from './config.mjs';

const retentionMs = 12 * 60 * 60 * 1000;
const activityMs = 5 * 60 * 1000;
const characters = new Set(['saved','none','unavailable']);

function hash(value) {
  return createHash('sha256').update(value).digest();
}

function validTimestamp(value, limit) {
  return Number.isSafeInteger(value) && value > 0 && value <= limit;
}

function cleanPlayer(player, now) {
  const suppliedIncidents = player?.incidents ?? [];
  if (!player || !isSnowflake(player.discordId) || !validTimestamp(player.observedAt,now + 60000)
    || player.observedAt < now - activityMs || !validTimestamp(player.trackedSince,player.observedAt)
    || !Number.isSafeInteger(player.playSeconds) || player.playSeconds < 0
    || player.playSeconds > Math.ceil((player.observedAt-player.trackedSince)/1000)+60
    || typeof player.online !== 'boolean' || !characters.has(player.character)
    || typeof player.cadAvailable !== 'boolean' || !Array.isArray(suppliedIncidents) || suppliedIncidents.length > 8) return null;
  const incidents = suppliedIncidents.filter(incident => Number.isSafeInteger(incident?.id) && incident.id > 0
    && typeof incident.status === 'string' && incident.status.length <= 40
    && typeof incident.priority === 'string' && incident.priority.length <= 40)
    .map(({id,status,priority})=>({id,status,priority}));
  if (incidents.length !== suppliedIncidents.length || (!player.cadAvailable && incidents.length)) return null;
  return {
    discordId:player.discordId, observedAt:player.observedAt, trackedSince:player.trackedSince,
    playSeconds:player.playSeconds, online:player.online, character:player.character,
    cadAvailable:player.cadAvailable, incidents
  };
}

export function createFiveMBridge(secret, HttpError) {
  const snapshots = new Map();
  const expected = secret ? hash('Bearer ' + secret) : null;

  function verify(authorization) {
    if (!expected) throw new HttpError(503,'The FiveM bridge is not configured.');
    if (!authorization || !timingSafeEqual(hash(authorization),expected)) {
      throw new HttpError(401,'FiveM bridge authorization required.');
    }
  }

  function accept(data) {
    const now = Date.now();
    if (!Array.isArray(data.players) || !data.players.length || data.players.length > 6) {
      throw new HttpError(400,'Send 1–6 FiveM player snapshots.');
    }
    const players = data.players.map(player=>cleanPlayer(player,now));
    if (players.some(player=>!player) || new Set(players.map(player=>player.discordId)).size !== players.length) {
      throw new HttpError(400,'Invalid FiveM player snapshots.');
    }
    for (const [id, snapshot] of snapshots) if (now - snapshot.observedAt > retentionMs) snapshots.delete(id);
    for (const player of players) {
      if (player.observedAt >= (snapshots.get(player.discordId)?.observedAt || 0)) {
        snapshots.delete(player.discordId);
        snapshots.set(player.discordId,player);
      }
    }
    while (snapshots.size > 512) snapshots.delete(snapshots.keys().next().value);
    return {accepted:players.length};
  }

  function profile(discordId) {
    const snapshot = snapshots.get(discordId);
    const age = snapshot ? Date.now() - snapshot.observedAt : Infinity;
    if (age > retentionMs) return {configured:Boolean(expected), player:null};
    const {observedAt,trackedSince,playSeconds,character} = snapshot;
    const online = snapshot.online && age < activityMs;
    return {configured:true,player:{
      observedAt,trackedSince,playSeconds,character,online,
      cadAvailable:online && snapshot.cadAvailable,
      incidents:online && snapshot.cadAvailable ? snapshot.incidents : []
    }};
  }

  return { verify, accept, profile };
}
