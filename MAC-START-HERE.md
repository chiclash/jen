# Open CHARCOAL × Crocs on your Mac

You do not need an API key, API credits, billing, or a paid deployment. Paid AI stays off. The site runs on your Mac and opens in Chrome.

## 1. Unzip the project

Double-click the downloaded ZIP in Finder. Open the extracted project folder; it should contain `package.json`, `frontend`, and `server`.

## 2. Install Node.js 24

If you do not already have Node.js 24 or newer, download the free macOS installer from [nodejs.org/en/download](https://nodejs.org/en/download). Choose Node.js 24 and the installer for your Mac.

After installation, open **Terminal** from Applications → Utilities. Check:

```sh
node --version
npm --version
```

The Node version should start with `v24` or a newer major version. Close and reopen Terminal if `node` is not found immediately after installation.

## 3. Open the project folder in Terminal

In Terminal, type `cd`, then press **Space**. Drag the extracted project folder from Finder into Terminal, then press **Return**. This handles folder names containing spaces.

## 4. Install and start

Run the included helper:

```sh
bash './Start Website.command'
```

It checks Node.js, installs missing app dependencies for your Mac, skips development browser-testing tools, and starts the local server. It explicitly keeps paid AI disabled, even if a key is already configured elsewhere. No API key or `.env` file is needed.

Keep this Terminal window open while using the website.

If you prefer the manual commands, they are:

```sh
npm ci --omit=dev
CHARCOAL_ENABLE_PAID_AI=false npm start
```

## 5. Open Chrome

Enter this address in Chrome's address bar:

```text
http://127.0.0.1:3000
```

Use this server address rather than double-clicking `frontend/index.html`; saved designs and backend features need the running server.

You can work with the manual cat profile, local previews, and saved customization without a paid service. Live AI recognition and image generation remain disabled. The app must show that limitation clearly rather than pretend to generate a cat.

## Stop and reopen later

Press **Control + C** in Terminal to stop the server. Next time, open Terminal in the same project folder and run:

```sh
bash './Start Website.command'
```

Keep the project's `.data` folder to preserve saved work. Use the same Chrome profile and retain its site cookies so the app can reconnect to your saved browser session. Removing the project folder or clearing cookies can affect restoration.

## If it does not start

- **`node` or `npm` not found:** Install Node.js 24, then reopen Terminal.
- **`package.json` not found:** Terminal is in the wrong folder. Repeat step 3 using the folder containing `package.json`.
- **Port 3000 already in use:** Start with `CHARCOAL_ENABLE_PAID_AI=false PORT=3001 npm start`, then open `http://127.0.0.1:3001` in Chrome.
- **An image-processing dependency fails:** Confirm that you installed Node for your Mac's architecture, then rerun `npm ci --omit=dev`. Keep optional dependencies enabled; they include the native Mac image-processing libraries.

The package lock includes native dependencies for both Apple Silicon and Intel Macs. This setup was inspected for macOS compatibility, but has not been executed on an actual Mac.
