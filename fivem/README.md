# The Western Line FiveM portal bridge

This server-only resource sends each player’s own Discord-linked FiveM activity to the member portal over HTTPS. Playtime is stored on the FiveM server and starts when the bridge is installed. The portal holds recent snapshots; a restart or a new session sync may be needed if the last snapshot is no longer available.

## Install

1. Copy the complete `twl_portal_bridge` folder into your FiveM resources.
2. Generate a random URL-safe secret of at least 32 characters. Set it as `FIVEM_BRIDGE_SECRET` in the Render web service’s private environment. Set the same value in the FiveM server’s private `server.cfg` before the resource starts. Use `set` to keep this convar server-only.
3. Start the character and CAD resources you use. Then place these lines in the private FiveM server configuration and restart.

```cfg
set twl_portal_url "https://twl-member-portal.onrender.com"
set twl_portal_bridge_secret "REPLACE_WITH_YOUR_PRIVATE_BRIDGE_KEY"
ensure twl_portal_bridge
```

4. Join FiveM with a Discord identifier visible to the server. Open **FiveM activity** in the portal and refresh after you’ve loaded in.

## Character and CAD sources

- The bridge reads the existing `westerns_characters:GetCharacter` server export. That resource stores the character’s appearance. The bridge sends the saved-appearance status and leaves the appearance and platform identifiers on the FiveM server.
- For the **twl_multi 1.2.5** CAD layout, append the contents of `twl_multi-cad-export.lua` to the end of the existing `twl_multi/server/main.lua` file. The export uses the resource’s current duty and incident permissions. It sends assigned incident numbers, statuses and priorities only for the player’s own unit. Confirm the installed CAD resource and its version before applying the block.
- If the player has no Discord identifier or the resources are unavailable, the portal reports that status. It does not estimate old playtime.
