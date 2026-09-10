# Folder Structure

As of 2026-08-20. Older design docs may still mention Tailwind/shadcn; the live web UI uses Next.js App Router and inline styles.

```
Mastermind-Minecraft-Server-Manager/
├── control-plane/                 # NestJS API
│   └── src/
│       ├── app.module.ts
│       ├── auth/
│       ├── orgs/
│       ├── hosts/
│       ├── jobs/
│       ├── scheduler/
│       ├── alerts/
│       ├── player-auth/
│       ├── donations/             # Stripe, shop catalog, kit grants
│       ├── prismacore/
│       ├── allocs/
│       ├── players/               # roster, inventory, Set deaths
│       ├── logs/
│       ├── health-monitor/
│       ├── websocket/
│       └── prisma.service.ts
├── web/                           # Next.js App Router
│   └── src/
│       ├── app/
│       │   ├── layout.tsx
│       │   ├── page.tsx
│       │   ├── (auth)/login/
│       │   ├── (dashboard)/       # staff: live-map, players, donator-shop, purchases, …
│       │   ├── player/            # portal: map, profile, shop, cart
│       │   └── api/               # BFFs: live-map, player-map, player-auth, donations, item-icons
│       ├── components/
│       └── lib/
├── agent/                         # Go host agent (7DTD adapter, ITEM_CATALOG items+blocks)
├── discord-bot/
├── infra/
│   ├── docker-compose.yml
│   ├── .env.example
│   └── prismacore/
├── docs/
│   ├── architecture.md
│   ├── allocs.md
│   ├── prismacore.md
│   ├── DIGITALOCEAN_DEPLOYMENT.md
│   ├── release-0.0.12-context.md
│   ├── release-0.0.13-context.md
│   ├── release-0.0.14-context.md
│   ├── release-0.0.15-context.md
│   └── live-features-2026-08-20.md
└── human/user-guide.md
```
