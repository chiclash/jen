# CHARCOAL × Crocs Customizer

The original website, refactored into a vanilla JavaScript frontend and a Node.js backend. The visual style, website sections, footwear assets, and six-step flow remain: Upload → Recognize → Personality → Generate → Customize → Review.

The frontend/backend boundary supports image generation from the uploaded cat photos. **Paid AI is disabled by default, and no paid API calls are authorized for the current work.** The reference-cat library is not a substitute for generated results. When generation is unavailable, the application reports that fact; it does not simulate successful AI output.

## Run locally

Use Node.js 24 or newer.

```sh
npm ci
cp .env.example .env
npm start
```

The server serves both the frontend and API on port `3000`, bound to `127.0.0.1` by default. Set `PORT` to change the port. For backend reloads during development, use `npm run dev`.

The application can start without a key, credits, API billing, or a paid deployment. Manual profile editing, local footwear rendering, and saved customization do not require a paid service. Automated tests use mocked responses.

## AI integration and the spending gate

The optional provider integration targets the OpenAI API with configurable vision and image-generation models. These are separately billed APIs: a ChatGPT or Codex subscription does not automatically cover them. Do not buy API credits, enable billing, use a paid deployment, or run a live request as part of the current setup.

The default configuration is:

```dotenv
CHARCOAL_ENABLE_PAID_AI=false
CHARCOAL_OPENAI_API_KEY=
OPENAI_VISION_MODEL=gpt-4.1-mini
OPENAI_IMAGE_MODEL=gpt-image-1.5
```

Both automated photo analysis and image generation are gated. A key alone must **never** activate AI. With the spending gate disabled, these operations return `AI_PAID_DISABLED` before making any external call.

Any future live test requires an exact expected USD quote based on the current provider pricing, configured models, image sizes, quality, and requested operations, followed by explicit user approval **before** activation. The current setup must leave the spending gate disabled. No dollar estimate is asserted here because live usage has not been approved or measured.

If a future, explicitly approved task enables the provider, the credential is an OpenAI project API key with access to the selected models. Store it only in the backend's ignored `.env` file or a secret manager. In Codex cloud settings, the secret name is `CHARCOAL_OPENAI_API_KEY` and its HTTPS destination is `api.openai.com`. Never put a key in frontend JavaScript, HTML, generated designs, a committed file, or chat. Do not enter or request a key for the current no-paid-services workflow.

The configured model names are defaults, not a promise that every API project has access to them. They can be changed to compatible models through the environment variables above. Model changes must retain image-input support for recognition and reference-image editing support for generation.

An internal readiness check is:

```sh
curl --fail http://127.0.0.1:3000/api/health
```

Inspect `paidRequestsEnabled` as well as the reported AI configuration. A configured key does **not** prove model access, network connectivity, successful image requests, or permission to incur charges. With paid AI disabled, the endpoints must return `AI_PAID_DISABLED`; if a future approved configuration enables the gate but has no usable key, they return `AI_NOT_CONFIGURED`.

## How personalization works

1. The backend validates and stores one to three cat photos for the browser session.
2. The owner can edit a profile locally: fur colors, facial markings, eye color, face and ear shape, and distinguishing features. Automated vision analysis remains disabled under the current spending gate.
3. The optional, gated generation pipeline sends actual uploaded photos to the model and uses a generated identity reference across charms and modes. It cannot run as an unapproved fallback.
4. That pipeline produces a material texture and a small set of charms: face, full body/personality pose, sleeping pose, and favorite toy. Realistic Fur and Artistic Interpretation have separate style instructions while sharing the same cat references.
5. The renderer composites available artwork onto the original footwear views. The silhouette, cream base, removable upper and strap construction, and paw-shaped outsole remain based on the supplied design assets. Bottom view shows the original outsole rather than invented upper artwork. A local/manual preview must not be labelled as a generated AI result.

If live generation is approved in the future, modes are generated when requested. The first-mode pipeline normally requests one shared identity, one texture, and four charms; a second mode reuses an unchanged identity and requests five images. Individual charm regeneration should not regenerate the whole design. These potential request counts are not authorization to execute them, and there is no automatic paid retry loop.

Reference-image prompting improves identity consistency but cannot guarantee perfect likeness. Review real outputs against the uploaded photos, especially asymmetric markings, eye colors, and face shape. The prompts alone do not establish that visual quality has been validated.

## Saved designs

The backend stores photos, generated images, profiles, and customization state beneath `DATA_DIR` (default `.data`). Images use durable, session-scoped asset URLs rather than browser-only blob URLs.

Retain this directory to keep designs across backend restarts. The browser's HttpOnly session cookie identifies its saved work; retaining server data alone will not reconnect a browser that has cleared that cookie. This is browser-session persistence, not an account system or cross-device design library.

For hosted use, mount a persistent volume at `DATA_DIR` and serve the frontend and API from the same origin. See [Deployment](docs/deployment.md) for the storage and hosting boundaries.

## Project structure

```text
frontend/
  index.html          Original website sections and six-step layout
  styles/site.css     Original visual styling
  src/app.js          UI, confirmed cat profile, and customization state
  src/api.js          Same-origin API client and generation polling
  src/rendering.js    Generated artwork composited onto original footwear
  a/                  Original footwear and reference assets
server/
  index.js            HTTP API and static frontend server
  store.js            Session, photo, and generated-asset persistence
  jobs.js             Generation orchestration and cancellation
  openai.js           Real vision and image-edit API integration
test/                 Automated checks
```

The [API contract](docs/api-contract.md) describes the frontend/backend boundary.

## Validate changes

```sh
npm run check
npm test
```

Transport and server tests use explicitly mocked provider responses so they can run without a key or charges. They also check that the disabled spending gate blocks external calls. These tests verify request construction, state handling, errors, and persistence; they do not prove that a live provider works or that generated cats resemble the photos. Live validation requires a separate, explicitly approved task after the exact expected USD quote is supplied.

## Current configuration boundary

No API key was available during the initial implementation, and no paid requests or paid deployments were performed. The spending gate remains disabled. Real AI output and likeness remain unverified; that limit must stay visible rather than being hidden by a preset cat or a simulated result.
