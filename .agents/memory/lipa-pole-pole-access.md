---
name: Lipa Pole Pole access
description: The product's core learning rule for progressive access.
---

Successful payment callbacks, not payment intent creation, are the source of truth for cumulative paid balance. A module is accessible when that balance meets its configured unlock amount; pending, failed, cancelled, refunded, and duplicate transactions must not unlock content.

**Why:** The product is pay-as-you-go learning, so access must remain safe and consistent even when M-Pesa callbacks are delayed or retried.

**How to apply:** Keep payment ledgers idempotent and derive dashboard, course, and module access from confirmed completed transactions on the server.