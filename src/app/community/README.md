# Community

Optional community board built into Command GCS. Provides changelog, a kanban board, roadmap, and a contact form.

All community data lives on the Altnautica Convex backend. The hosted version at [command.altnautica.com/community](https://command.altnautica.com/community) runs it by default. Local builds have it disabled unless you configure your own backend.

## Enabling it

1. Set up a [Convex](https://convex.dev) project and deploy the functions from `website/convex/`
2. Set `NEXT_PUBLIC_CONVEX_URL` in your `.env.local` to your Convex deployment URL
3. Restart the dev server

Without `NEXT_PUBLIC_CONVEX_URL`, the community section shows a fallback message. Everything else in the GCS works normally.

## Routes

| Route | What it does |
|-------|-------------|
| `/community/changelog` | Version history and release notes |
| `/community/kanban` | Admin-only board for triaging items |
| `/community/roadmap` | Public roadmap view |
| `/community/contact` | Contact form (no auth required) |

## File layout

```
app/community/
├── layout.tsx              # Tab navigation + Convex availability gate
├── changelog/page.tsx      # Changelog list
├── kanban/page.tsx         # Admin kanban board
├── roadmap/page.tsx        # Roadmap view
├── contact/page.tsx        # Contact form route
└── README.md               # This file

components/community/
├── AuthGate.tsx             # Auth gate for protected actions
├── CategoryBadge.tsx        # Category badge display
├── ChangelogDetail.tsx      # Single changelog detail view
├── ChangelogEditor.tsx      # Changelog entry editor
├── ChangelogEntry.tsx       # Single changelog entry
├── ChangelogTimeline.tsx    # Changelog list with admin controls
├── CommunityComments.tsx    # Comments on items
├── ContactForm.tsx          # Contact form (name, email, subject, message)
├── KanbanBoard.tsx          # Drag-and-drop kanban
├── KanbanCard.tsx           # Kanban card component
├── KanbanColumn.tsx         # Kanban column component
├── RoadmapView.tsx          # Grouped roadmap display
└── StatusBadge.tsx          # Status badge display

lib/
├── community-api.ts         # Typed Convex function references
└── community-types.ts       # Shared types (ItemType, ItemCategory, etc.)
```

## Auth

- **Viewing** changelog, roadmap: public, no auth needed
- **Contact form**: public, no auth needed
- **Kanban board**: admin only
- **Comments**: requires auth

## Not required for drone operations

The community feature is completely separate from flight control, telemetry, mission planning, and FC configuration. Removing or disabling it has zero effect on drone functionality.
