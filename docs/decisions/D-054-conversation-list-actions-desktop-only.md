---
id: D-054
title: The conversations list is title-only on mobile; its row actions live inside the conversation
date: 2026-08-29
---

# D-054: The conversations list is title-only on mobile; its row actions live inside the conversation

*Decided: 2026-08-29*

**Context**: At 390px the conversations list spent roughly half its width on
chrome — a 36px select checkbox, a 12px ✎ rename glyph, and a 116px Acciones
column holding two icon buttons at their 44px tap targets — leaving the title, the
only column that matters on a phone, ellipsised at 12px after a few words. The
owner compared it against Claude's own chat list, which shows a large title and a
timestamp and nothing else.

**Decision**: below `md` (768px) the conversations list drops the checkbox column,
the ✎ pencil and the Acciones column from layout (`hidden md:table-column` on the
`<col>`, `hidden md:table-cell` on `th`/`td`). The freed width goes to the title,
which wraps to two lines at 15px with a muted meta line (relative time · context)
replacing the columns that are hidden. Tapping the title opens the conversation.

The actions those columns carried are reachable from inside the conversation
instead: `ConversationDetailActions` renders rename / archive / open-in-context in
the `/conversations/[id]` header strip, phone-only, each at the 44px floor.

At `md` and up nothing changes — every column, the pencil, the bulk-select flow
and the 46px row height stay exactly as they were.

**Alternatives rejected**:
- *Keep the actions and shrink them.* They were already at the 44px tap floor;
  shrinking them below it is the bug D-121 exists to prevent.
- *Swipe actions on the row.* More code and a hidden affordance, for actions that
  have an obvious home one tap away.

**Rationale**: A phone list is for finding the conversation, not administering it.
Once the actions have a home inside the conversation, the columns are pure cost.

**See**: `dashboard/components/ConversationsTable.tsx`,
`dashboard/components/ConversationDetailActions.tsx`,
`dashboard/app/globals.css` (`.conv-title-*`, `.conv-detail-*`),
`dashboard/e2e/mobile-conversations.spec.ts` (asserts both directions of the
breakpoint), [D-044](D-044-mobile-breakpoint-and-pad-x-token.md).
