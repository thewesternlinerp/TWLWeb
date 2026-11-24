# The Western Line

A public FiveM website and Discord-only member portal. The website includes the Western Line roundel, 21 screenshots, service departments, the leadership team and the FiveM connection instructions.

## Preview on your PC

Install Node.js 22 or newer, open PowerShell in this folder and run `node server/index.mjs`. Open [the local website](http://localhost:8787/) or [the local portal](http://localhost:8787/portal.html). The preview serves the public pages and shows the sign-in setup status.

## Publish the public website on GitHub

1. In your Western Line GitHub account, create a repository named `western-line-portal` and upload the **contents** of this folder. Keep the folder structure. A public repository supports Pages on GitHub Free. Review visibility before creating the repository.
2. Open **Settings → Pages**. Select **Deploy from a branch**, then `main` and `/docs`, and click **Save**. GitHub shows the public URL after deployment. See [GitHub’s publishing-source instructions](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site).
3. The **Join Discord** button uses the verified Western Line invite `https://discord.gg/nWnRWxgh8j`. If the invite changes, update `discordInvite` in `docs/config.js` and the button link in `docs/index.html`.
4. Once the Discord backend is deployed below, set `portalOrigin` in the same file to its HTTPS origin and update GitHub. GitHub Pages serves the static pages. Discord sign-in returns to the separate backend so session cookies and bot tokens stay on that service.

## Connect Discord

### Free Render deployment for TWLWeb

Upload the extracted `render.yaml` to the root of [TWLWeb](https://github.com/thewesternlinerp/TWLWeb). Upload the updated `western-line-portal` folder alongside it. The blueprint uses the existing `main` branch and creates one Free Node web service, with no database or disk. It generates the session key for you.

1. In [Render](https://dashboard.render.com/), choose **New → Blueprint**, connect the TWLWeb repository, and review the Free plan. Application ID `1566252502419247164` is already set. When prompted, enter the OAuth client secret and rotated bot token in Render.
2. Copy the service's assigned HTTPS URL. In the [Discord Developer Portal](https://discord.com/developers/applications/1566252502419247164/oauth2), add that URL followed by `/auth/callback` under **OAuth2 → Redirects**. Use the exact URL Render assigned. The member portal builds the authorization link with the `identify` scope.
3. Test the backend's `/api/status` and `/portal.html`, then set `portalOrigin` in GitHub’s `western-line-portal/docs/config.js` to the backend’s HTTPS origin. Keep that file public and only put the backend URL there.
4. To enable role changes and applications, set `MANAGEABLE_ROLE_IDS` and `APPLICATIONS_CHANNEL_ID` in Render after checking the bot permissions and private channel access below.

Render's Free web service can go idle. The first portal visit after a period of inactivity can take longer while it starts. See [Render's free plan limits](https://render.com/docs/free).

### Discord credentials and manual hosting

1. In the [Discord Developer Portal](https://discord.com/developers/applications), open the Western Line Discord application. On the **Bot** page, reset the token shared in chat. If the same bot is used by your FiveM resources, enter the rotated value in those resources' private server-side settings as well. Keep client secrets, bot tokens and session keys in the hosting service’s secret environment or an ignored local `.env`.
2. In the application’s **OAuth2** settings, add the exact callback URL: `https://YOUR-BACKEND-HOST/auth/callback`. For local Discord testing, add `http://localhost:8787/auth/callback` too. Copy the application ID and client secret into the variables below.
3. Make sure the bot is in guild `1566132871163412581`. The portal uses the ordinary Discord HTTP API and the OAuth `identify` scope for sign-in. To enable role management, grant the bot **Manage Roles** and position its highest role above the member roles you want it to change. Review channel overrides as well as guild-wide permissions for every role you allow.
4. To accept applications, create a private text channel for reviewers. Deny **View Channel** for `@everyone`. Grant access only to the review team and the bot, giving the bot **Send Messages** and **Embed Links** there. Copy its channel ID.
5. Use a Node 22+ HTTPS host. For [TWLWeb](https://github.com/thewesternlinerp/TWLWeb) on Render, create a **Web Service** and select **Public Git Repository**. Paste `https://github.com/thewesternlinerp/TWLWeb` and use branch `main`, root directory `western-line-portal`, runtime **Node**, build command `npm install`, start command `npm start` and health check path `/api/status`. Set `HOST=0.0.0.0` and leave `PORT` to Render. Deploy with the four Discord and session variables empty until Render assigns the HTTPS URL.
6. Set `PUBLIC_ORIGIN` in Render to that HTTPS URL. Add the matching `/auth/callback` redirect to the Discord application, then save the four required variables below together in Render and let it redeploy. Open `/api/status` on the backend to check that it returns `{"configured":true}`, then open `/portal.html` on the backend and test Discord sign-in. Finally, put the backend’s HTTPS origin in `portalOrigin` in GitHub’s `western-line-portal/docs/config.js` and commit the edit to connect the public site. Only the public backend URL belongs in that file.

| Variable | Value |
| --- | --- |
| `PUBLIC_ORIGIN` | Backend HTTPS origin with no path. The Render blueprint uses Render's assigned URL automatically. |
| `DISCORD_CLIENT_ID` | Discord application ID |
| `DISCORD_CLIENT_SECRET` | OAuth client secret from the same application |
| `DISCORD_BOT_TOKEN` | Rotated token for the guild bot |
| `SESSION_SECRET` | Random signing key of at least 32 bytes. Generate locally with `node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"` |
| `APPLICATIONS_CHANNEL_ID` | Optional. Private Discord text channel for applications and support tickets. Deny View Channel to `@everyone` and grant direct access to the bot and the three leadership accounts. |
| `ANNOUNCEMENTS_CHANNEL_ID` | Optional. The guild text or announcements channel to display in the member portal. Members need Discord permission to view it and read message history. |
| `MANAGEABLE_ROLE_IDS` | Optional. Comma-separated role IDs approved for portal changes |

To run with a local `.env`, copy `.env.example` to `.env`, fill the settings and run `node --env-file-if-exists=.env server/index.mjs`. Production needs a stable session secret across restarts. The portal does not need a database. Discord stores the application messages and its own role audit log.

## Member tools

- Sign-in requires current membership in The Western Line’s Discord server. The bot reads live Discord roles when the portal loads and when a member selects **Refresh Discord roles**.
- WesternSpi, Sean and Zac can add or remove explicitly configured member roles when signed in using the listed leadership accounts. Managed roles and moderator or administrator roles are blocked. Discord still enforces the bot’s role hierarchy.
- Members can send and track recent MET, LAS and LFB applications and support tickets when the private review channel is configured. Leadership can review their status in the portal. Role assignments are managed separately.
- The announcements page shows the latest 12 Discord messages where the member has permission to view channel history. Discord remains the source for the original posts and attachments.
- The FiveM connection guide uses the publicly listed `cfx.re/join/vqqgxbx` code. Cfx.re returned the matching join token during setup. An in-game connection was not tested. For in-game duties or CAD, use the relevant installed FiveM resources and Discord instructions.

Run `node --test` for the local integration checks. They simulate Discord, so finish deployment by verifying sign-in with an actual guild member, refreshing the roles, testing an approved role with a test member, and checking that an application reaches the private channel.
