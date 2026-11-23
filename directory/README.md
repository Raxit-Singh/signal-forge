# Listing Heardex in the Claude, ChatGPT and Gemini app directories

Everything needed to list the Heardex MCP connector so people can add it from each app's list instead of
pasting the address. Listing text is in [LISTINGS.md](LISTINGS.md). Rebuild icons and the ChatGPT ZIP with
`node scripts/directory-kit.mjs`.

## 0. Before any of them

1. **Reviewer account** (ChatGPT and Gemini need one; Claude only for its Verified badge).
   - Make an address such as `reviewer@heardex.com` (Spaceship forwarding to your inbox is enough).
   - Add it to `EARLY_ACCESS_EMAILS` in Vercel, redeploy, then sign up at www.heardex.com/signup with a password
     and confirm the email. No Google/GitHub sign-in, no two-step codes.
   - Give it a workspace with one product that already has collected mentions, so reviewers see real issues.
2. **Try every tool yourself** in Claude, ChatGPT and Gemini as a custom connector (all three portals ask you to
   confirm this).
3. **Demo video** (ChatGPT): a 1–2 minute screen recording of connecting Heardex in ChatGPT and asking two of the
   starter prompts. Upload it unlisted (YouTube, Loom) and keep the link.

## 1. Claude — easiest

1. Open https://claude.ai/directory/manage → Submit new → MCP connector (needs a paid Claude plan).
2. Connection: `https://www.heardex.com/api/mcp`. The tools sync on their own; all ten have titles and
   read/write annotations.
3. Fill the listing from LISTINGS.md → Claude. Icon: `icons/heardex-512.png`.
4. Authentication: OAuth, no client ID or secret.
5. Confirm testing and the policy boxes, then submit.

It's scanned automatically and normally listed as a Community connector. Status is on the same page.
Strangers who find it will see "Heardex isn't open yet" while `EARLY_ACCESS_EMAILS` is set, so you may want to
submit this one when sign-ups open.

## 2. ChatGPT

1. Verify yourself (or the business) at https://platform.openai.com/settings/organization/general.
2. Open https://platform.openai.com/plugins → Upload new or existing plugin → upload
   `heardex-chatgpt-plugin.zip`.
3. In "Connect MCP server", copy the domain-verification token into Vercel as `OPENAI_APPS_CHALLENGE`
   (Production) and redeploy. Check https://www.heardex.com/.well-known/openai-apps-challenge shows only the token,
   then finish verification and connect (OAuth, dynamic registration).
4. Review details: the reviewer email and password, the login URL `https://www.heardex.com/login`, and the
   demo video link. Never put these in the ZIP.
5. Submit. Feedback arrives by email; reply to it to appeal.

## 3. Gemini

1. Open https://connected.google.com/console (accept the Connected Apps terms; access may be limited).
2. Create a connected app: connection type MCP server, endpoint `https://www.heardex.com/api/mcp`.
3. Domain check: put the token in Vercel as `GOOGLE_CONNECTED_APPS_TOKENS`, redeploy, and check
   https://www.heardex.com/.well-known/google-connected-apps.
4. Authorization: user-delegated, dynamic client registration. Open "View" on the redirect URIs Google lists
   and check they're accepted (see LISTINGS.md); if any aren't, they need adding in `src/lib/agent/oauth.ts`.
5. Metadata from LISTINGS.md → Gemini, icon `icons/heardex-512.png` (512×512).
6. Add testers (Gmail accounts), try every example prompt, then Releases → Send for review, with the reviewer
   account and short testing instructions for your Google contact.
