# Community

Optional community section built into Command GCS. Provides a changelog and a contact form.

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
| `/community/contact` | Contact form (no auth required) |

## File layout

```
app/community/
├── layout.tsx              # Tab navigation + Convex availability gate
├── changelog/page.tsx      # Changelog list
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
└── StatusBadge.tsx          # Status badge display

lib/
├── community-api.ts         # Typed Convex function references
└── community-types.ts       # Shared types (ItemType, ItemCategory, etc.)
```

## Auth

- **Viewing** changelog: public, no auth needed
- **Contact form**: public, no auth needed
- **Comments**: requires auth

## Not required for drone operations

The community feature is completely separate from flight control, telemetry, mission planning, and FC configuration. Removing or disabling it has zero effect on drone functionality.
