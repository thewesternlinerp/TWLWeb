-- Append this block to twl_multi/server/main.lua for the 1.2.5 server layout.
exports('GetPortalCadSummary', function(src)
    if GetInvokingResource() ~= 'twl_portal_bridge' then return nil end
    src = tonumber(src)
    if not player(src) then return nil end
    local permissions = P.peek(src)
    local identity = P.identity(src)
    if not identity or not permissions.cad or not permissions.duty or not permissions.duty.active then return nil end
    local result = {}
    for index = #calls, 1, -1 do
        local call = calls[index]
        if call.units and call.units[identity] and visibleCall(permissions, call) then
            result[#result + 1] = {id = call.id, status = call.status, priority = call.priority}
            if #result == 8 then break end
        end
    end
    return result
end)
