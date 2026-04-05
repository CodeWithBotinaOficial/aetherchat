# AetherChat

> A decentralized, peer-to-peer chat platform built entirely in the browser — no servers, no tracking, no compromise.

AetherChat connects people across the globe using WebRTC (via PeerJS) so messages flow directly between browsers. Private 1-to-1 conversations are end-to-end encrypted, and the platform avoids analytics/telemetry by design.

---

## ✨ Features

- **Global Chat**: real-time public chat shared peer-to-peer between connected browsers.
- **Private Chats (E2EE)**: end-to-end encrypted 1-to-1 messaging using ECDH (P-256) + HKDF-SHA256 + AES-GCM (256-bit).
- **Message replies + multi-quote**: reply to one or more messages at once (Global + Private), with clickable quote cards that jump to the original.
- **Message edit + delete**: edit/delete your own messages (Global has a 30-minute window; Private has no time limit). Edited messages show an indicator; deleted messages are soft-deleted with a placeholder (IDs are preserved for quotes).
- **Quote cascades**: if a cited message is edited or deleted, every message that quoted it updates its preview (or shows `[ Original message deleted ]` with no click behavior).
- **No centralized message server**: there is no backend that stores or processes chat content.
- **Local-only identity**: profiles live in your browser storage; clearing site data resets identity and local history.
- **Offline-first UX**: the UI loads and remains usable even when the network is unavailable (private messages and private edits can queue locally until encryption/session is ready).
- **Automatic cleanup**: local retention policies delete old data on a schedule (global + private history).
- **Responsive UI**: mobile TopBar + BottomNav, tablet icon rail, desktop sidebar, wide/TV max width.
- **Responsive message layout**: bubbles are always left/right aligned by author and scale comfortably across mobile, tablet, and desktop.
- **Terms & Conditions page**: full Terms of Service and Privacy Policy rendered in-app.
- **SEO-ready**: full metadata, Open Graph/Twitter cards, JSON-LD structured data, `robots.txt` and `sitemap.xml`.
- **Production-ready Cloudflare Pages config**: SPA fallback routing and security headers (`_redirects`, `_headers`).

---

## 🛠️ Tech Stack

| Layer | Technology |
|---|---|
| Framework | SvelteKit (static build) |
| P2P / WebRTC | PeerJS |
| Local Storage | Dexie.js (IndexedDB) |
| Encryption | Web Crypto API (native) |
| Styles | UnoCSS + Uno preset |
| Hosting | Cloudflare Pages |

---

## 🔧 How It Works (High Level)

- **Discovery**: a lightweight lobby peer ID is used so newcomers can join a network and receive a snapshot of peers + registry state.
- **Direct connections**: after discovery, the app forms a limited mesh of direct DataChannel connections to reduce spam and stay within PeerJS limits.
- **Protocol messages**: peers exchange handshake metadata, public messages, private E2EE payloads, delivery acks, message edit/delete actions, and network state digests.
- **Replies (quotes)**: new messages can include a `replies` array referencing one or more earlier messages, plus a text snapshot captured at send time (private reply payloads are encrypted).
- **Local storage**: chat history, registry state, and E2EE key rings (local-only) are persisted in IndexedDB using Dexie.
- **Security enforcement**: receiving peers verify authorship for edits/deletes, and Global Chat enforces the 30-minute edit/delete window on the receiving side too.

---

## 💬 Reply & Quote System

AetherChat supports quoting one or more messages when composing a new message in both Global Chat and Private Chat.

- Desktop: a reply button appears on hover beside each message bubble.
- Mobile: swipe to reply (own messages swipe left; other messages swipe right) with a WhatsApp-style visual indicator.
- The composer shows a pending replies area above the input; remove quotes individually or send to clear them.
- Sent messages render quoted cards above the message text; clicking a quote scrolls to and highlights the original (and attempts to load older history if needed).
- If a quoted/original message is later edited, quote previews update everywhere to match the new text snapshot.
- If a quoted/original message is later deleted, quote cards show `[ Original message deleted ]` in muted text and are no longer clickable.

Privacy note: for Private Chats, reply snapshots and reply metadata are encrypted along with the message payload (no plaintext reply metadata is stored or transmitted).

---

## ✏️ Message Edit & Delete

Each message bubble can show a context menu (⋯) for actions, but only on messages you authored.

- **Global Chat rules**
  - You can **edit** or **delete** your own messages only within **30 minutes** of sending.
  - After 30 minutes, edit/delete options disappear and incoming edit/delete packets for older messages are rejected.
- **Private Chat rules**
  - You can **edit** or **delete** your own messages at any time.
  - You can never edit/delete the other participant's messages.
- **Edited messages**
  - Show an `edited` indicator next to the timestamp (with the edit time on hover).
  - Stay in their original position; ordering never changes on edit.
- **Deleted messages**
  - Are soft-deleted: the message ID is preserved, `deleted: true` is stored, and the text becomes a standard placeholder.
  - This ensures quoted replies can still reference the original message ID safely.
- **Editing UX**
  - Editing happens in the composer (the input switches to “Save/Cancel” mode).
  - `Escape` cancels an edit; `Enter` saves.
  - While editing, you can add/remove quoted replies and they are saved with the edit.

Private encryption note: private message bodies are encrypted as a small versioned envelope so metadata like `editedAt` is included inside ciphertext.

---

## 🧩 Overlay Rules (Tooltip vs Action Menu)

AetherChat has two overlays that can appear near a message:

- **User tooltip**: avatar/name/age and “Start Private Chat”
- **Message action menu**: ⋯ dropdown with Edit/Delete (own messages only)

These overlays are mutually exclusive:

- Opening the ⋯ menu closes any visible tooltip immediately.
- Opening the tooltip closes any open ⋯ menu immediately.
- The ⋯ trigger is a separate interaction zone and does not trigger tooltip events.
- On touch devices, the tooltip is intentionally triggered from the message identity area (avatar/username), not from the entire bubble.
- Clicking/tapping outside closes whichever overlay is open.

---

## 🚀 Getting Started

### Prerequisites

- Node.js `v22+`
- npm `v11+`

### Clone the repository

```bash
git clone https://github.com/CodeWithBotinaOficial/aetherchat.git
cd aetherchat
```

### Install dependencies

```bash
npm install
```

### Start the development server

```bash
npm run dev
```

Open your browser at `http://localhost:5173` and you're ready to go.

### PeerJS debug logging (optional)

PeerJS can be noisy in the console when peers disconnect or are unreachable. By default, AetherChat keeps PeerJS logs disabled.

Enable them only when debugging:

```bash
VITE_PEERJS_DEBUG=2 npm run dev
```

Valid values: `0` (disabled), `1` (errors), `2` (warnings), `3` (all).

### Build for production

```bash
npm run build
```

The static output will be in the `build/` directory, ready to deploy to Cloudflare Pages.

---

## 📁 Project Structure

```
src/
├── lib/
│   ├── stores/       # Global state (user, messages, peers)
│   ├── services/     # PeerJS, Dexie, and Crypto logic
│   ├── components/   # Reusable UI components
│   └── utils/        # Helper functions (colors, avatars, etc.)
└── routes/           # SvelteKit pages and layouts
```

---

## 🔒 Privacy Notes

- AetherChat does not ship analytics/telemetry by default.
- WebRTC is peer-to-peer: your IP address can be visible to peers you connect with (use a VPN if you need to hide it).
- Data retention is implemented locally in the browser via cleanup jobs.

---

## 🤝 Contributing

This project is developed by [CodeWithBotinaOficial](https://github.com/CodeWithBotinaOficial).  
Contributions, issues and feature requests are welcome.

Support email: support@codewithbotina.com

---

## 📄 License

[MIT](./LICENSE) © 2026 CodeWithBotinaOficial
