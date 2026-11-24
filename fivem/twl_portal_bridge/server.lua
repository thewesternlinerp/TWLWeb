local origin = GetConvar('twl_portal_url', 'https://twl-member-portal.onrender.com')
local secret = GetConvar('twl_portal_bridge_secret', '')
local interval = 120
local sessions, active = {}, {}
local latestObservation = 0
local lastWarning = 0

if not origin:match('^https://[%w.-]+$') or #secret < 32 or #secret > 128 or not secret:match('^[%w_-]+$') then
    print('[twl_portal_bridge] Set twl_portal_bridge_secret and an HTTPS twl_portal_url.')
    return
end

local function discordId(player)
    local value = GetPlayerIdentifierByType(player, 'discord')
    local id = value and value:match('^discord:(%d+)$')
    return id and #id >= 17 and #id <= 20 and id or nil
end

local function persist(session)
    SetResourceKvp('twl_portal_playtime:' .. session.id, json.encode({
        seconds = session.seconds, since = session.since
    }))
end

local function begin(player)
    if sessions[player] then return sessions[player] end
    local id = discordId(player)
    if not id or active[id] then return nil end
    local now = os.time()
    local ok, stored = pcall(json.decode, GetResourceKvpString('twl_portal_playtime:' .. id) or '{}')
    if not ok or type(stored) ~= 'table' then stored = {} end
    local since = math.max(1, math.min(now, math.floor(tonumber(stored.since) or now)))
    local seconds = math.max(0, math.min(now - since, math.floor(tonumber(stored.seconds) or 0)))
    local session = {id = id, since = since, seconds = seconds, tick = now, character = 'unavailable'}
    sessions[player], active[id] = session, player
    return session
end

local function characterState(player)
    if GetResourceState('westerns_characters') ~= 'started' then return 'unavailable' end
    local ok, data = pcall(function() return exports.westerns_characters:GetCharacter(player) end)
    if not ok then return 'unavailable' end
    return type(data) == 'table' and 'saved' or 'none'
end

local function assignedCalls(player)
    if GetResourceState('twl_multi') ~= 'started' then return false, nil end
    local ok, result = pcall(function() return exports.twl_multi:GetPortalCadSummary(player) end)
    if not ok or type(result) ~= 'table' then return false, nil end
    return true, #result > 0 and result or nil
end

local function capture(player, session, online)
    local now = os.time()
    session.seconds = math.min(math.max(0, now - session.since),
        session.seconds + math.min(interval + 60, math.max(0, now - session.tick)))
    session.tick = now
    if online then session.character = characterState(player) end
    persist(session)

    local available, incidents = false, nil
    if online then available, incidents = assignedCalls(player) end
    latestObservation = math.max(now * 1000, latestObservation + 1)
    return {
        discordId = session.id, observedAt = latestObservation, trackedSince = session.since * 1000,
        playSeconds = session.seconds, online = online, character = session.character,
        cadAvailable = available, incidents = incidents
    }
end

local function send(players)
    if #players == 0 then return end
    PerformHttpRequest(origin .. '/api/fivem/sync', function(status)
        if status ~= 200 and os.time() - lastWarning >= 180 then
            lastWarning = os.time()
            print(('[twl_portal_bridge] Portal sync returned HTTP %s. Check the server-only key and HTTPS origin.'):format(status))
        end
    end, 'POST', json.encode({players = players}), {
        ['Content-Type'] = 'application/json',
        ['Authorization'] = 'Bearer ' .. secret
    }, {followLocation = false})
end

local function syncPlayers()
    local batch = {}
    for _, raw in ipairs(GetPlayers()) do
        local player = tonumber(raw)
        local session = player and begin(player)
        if session then
            batch[#batch + 1] = capture(player, session, true)
            if #batch == 6 then send(batch); batch = {} end
        end
    end
    send(batch)
end

AddEventHandler('playerJoining', function()
    local player = tonumber(source)
    if not player then return end
    SetTimeout(5000, function()
        if not GetPlayerName(player) then return end
        local session = begin(player)
        if session then send({capture(player, session, true)}) end
    end)
end)

AddEventHandler('playerDropped', function()
    local player = tonumber(source)
    local session = sessions[player]
    if not session then return end
    send({capture(player, session, false)})
    sessions[player], active[session.id] = nil, nil
end)

AddEventHandler('onResourceStop', function(name)
    if name ~= GetCurrentResourceName() then return end
    for player, session in pairs(sessions) do capture(player, session, false) end
end)

CreateThread(function()
    Wait(5000)
    while true do
        syncPlayers()
        Wait(interval * 1000)
    end
end)
