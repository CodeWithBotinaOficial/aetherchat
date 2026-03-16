# AetherChat

> A decentralized, peer-to-peer chat platform built entirely in the browser — no servers, no tracking, no compromise.

AetherChat connects people across the globe through WebRTC technology, enabling real-time communication without any central infrastructure. Messages flow directly between browsers, private conversations are end-to-end encrypted, and no personal data ever leaves your device.

---

## ✨ What we're building

- **Global public chat** — open to anyone, no invite codes required
- **Private 1-to-1 messaging** — end-to-end encrypted via ECDH + AES-GCM
- **Zero backend** — P2P signaling only for the initial handshake, all data stays local
- **Automatic data retention policies** — 24h for global chat, 30 days for private messages
- **Unique visual identity per user** — dynamic color assignment, custom avatars

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

## 🤝 Contributing

This project is developed by [CodeWithBotinaOficial](https://github.com/CodeWithBotinaOficial).  
Contributions, issues and feature requests are welcome.

---

## 📄 License

[MIT](./LICENSE) © 2026 CodeWithBotinaOficial
