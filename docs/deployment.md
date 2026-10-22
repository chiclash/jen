# Deployment

Run the Node.js server as the application entry point. It serves the original website and the API from one origin; deploying only `frontend/` to a static host will not provide recognition, generation, or saved designs.

The current work permits no paid API usage, credits, billing, or paid deployment. Run locally or on already available infrastructure. Leave paid AI disabled, including automated vision analysis.

## Runtime configuration

| Variable | Purpose |
| --- | --- |
| `CHARCOAL_ENABLE_PAID_AI` | Spending gate. Default `false`; keep disabled for the current work. |
| `CHARCOAL_OPENAI_API_KEY` | Optional backend-only OpenAI project API key for a future approved task. A key alone cannot activate AI. |
| `OPENAI_VISION_MODEL` | Vision model, default `gpt-4.1-mini`. |
| `OPENAI_IMAGE_MODEL` | Reference-image generation model, default `gpt-image-1.5`. |
| `PORT` | HTTP listening port, default `3000`. |
| `HOST` | Listen address, default `127.0.0.1`. Use the address required by existing hosting infrastructure. |
| `DATA_DIR` | Persistent session and image storage directory, default `.data`. |
| `COOKIE_SECURE` | Set `true` when HTTPS terminates at a reverse proxy; local HTTP development uses a non-Secure cookie. |

Install dependencies with `npm ci` using Node.js 24 or newer, then start with `npm start`. Keep a single server process for the initial filesystem-backed implementation. Do not assume independent replicas share in-memory generation jobs or local files.

Neither an API key nor API billing is required to run the app, edit a profile manually, save designs, or run mocked tests. Both analysis and generation must reject requests with `AI_PAID_DISABLED` before external calls while the gate is disabled. Do not enable billing, buy credits, or change this gate as a routine deployment step.

Future live testing requires an exact expected USD quote using current pricing and the selected models, image sizes, quality, and operation count, followed by explicit user approval. Only an approved task may configure provider access and activate spending. A ChatGPT or Codex subscription does not cover separately billed API requests automatically.

An approved future provider integration requires outbound HTTPS to `api.openai.com` through the environment's supported proxy. Such requests send uploaded cat photos to OpenAI for recognition and generation. The current disabled workflow must make no such requests. Keep TLS and certificate verification enabled.

## Durable data

Mount a persistent writable volume at `DATA_DIR`. Include it in an appropriate backup policy if designs need to survive a machine or disk loss. Keep it outside the served frontend directory; it contains user-uploaded photos and generated artwork.

Session cookies identify a browser's stored data, and asset access is scoped to that session. This is sufficient for the initial local/single-user development workflow. It does not provide user accounts, recovery after clearing browser cookies, or cross-device sign-in. Clearing the current UI design is not a promise that every historical photo or generated image has been erased from disk.

Generation work is asynchronous. A saved design and finished image files can survive a server restart when storage is retained. Queued or running jobs from before a restart become failed jobs with `SERVER_RESTARTED`; a live HTTP connection or unfinished provider operation does not survive. Recheck interrupted work rather than claiming an in-progress generation completed.

## Public hosting

Use HTTPS and keep frontend/API requests on the same origin so the session cookie accompanies asset requests. The cookie is HttpOnly and SameSite=Strict; configure `COOKIE_SECURE=true` when a reverse proxy terminates TLS before forwarding HTTP to Node. For a public multi-user deployment, add account authentication, per-user generation quotas and rate limits, and an explicit retention/deletion policy before opening paid image generation to anonymous visitors. No paid hosting or paid generation is authorized for the current work. Keep API keys out of the browser regardless of deployment topology.

A multi-instance deployment needs shared durable storage and a shared job queue or equivalent coordination. Filesystem session storage and process-local jobs should not be treated as a distributed backend.

## Readiness checks

1. Start the application and check `/api/health` internally. Confirm that paid AI is disabled even if a key is present.
2. Upload a photo, enter the profile manually, and verify local customization and saved-state behavior. Confirm that requesting analysis or generation yields `AI_PAID_DISABLED` without contacting a provider.
3. Use explicit test fixtures to check Realistic Fur and Artistic Interpretation renderer paths. These fixtures must not appear as successful live generation in the product.
4. Check Side, Top, Back, and Bottom views. Confirm that the cream clog, vents, removable covers, strap pivot, and paw outsole remain consistent with the supplied footwear design.
5. In mocked tests, change photos while a request is running and confirm that older results cannot overwrite the new cat.
6. Reload the browser and restart the server with the same `DATA_DIR`; confirm that saved customization restores in the same browser session.

The automated provider tests use mocked network responses. Real AI generation and visual likeness remain unverified. A future live-service validation must wait for the quoted cost and explicit user approval; it is not part of the current readiness checks.
