# The Xero API spike

**This is not part of the skill.** Nothing here is installed, validated, or run
by the agent. It exists to answer one question that cannot be answered from
outside a real Xero organisation:

> Does Xero hand back bank statement lines, with a reconciled flag, through the
> ordinary Accounting API?

Everything else about the skill was settled from Xero's published
documentation. This is the one thing that was not.

## Why it matters

The answer decides whether the skill is a **reconciliation prep** tool working
from the real unreconciled queue, or a **coding review** over the transactions
and unpaid invoices Xero does expose. It also decides whether the write lane
ships at all: if the rows already exist in Xero, creating them again would
duplicate them.

## What has already been settled without it

- **The Finance API is out.** `BankStatementsPlus` needs Xero *financial
  services app partner* approval — a form, a review, and possibly fees. No solo
  founder is going through that, so outcome A1 in the plan is not reachable and
  the only live question is A2 versus B.
- **PUT creates, POST upserts.** Xero's own OpenAPI spec says PUT
  "Creates one or more spent or received money transaction" and POST
  "Updates or creates". The write lane uses PUT, which is why a retry cannot
  quietly update something.
- **The report's documented columns** are Date, Description, Reference,
  Reconciled, Source, Amount, Balance. The parser does not rely on that: it
  reads cells by header name, so a different order still works.

## Running it

1. Create the `Xero (read-only)` credential first — `docs/XERO_RECONCILIATION.md`
   Step 2 has every click. Connect it to your own organisation, or to the Xero
   Demo Company.
2. Import `999-spike-xero-api-check.json` into n8n by hand (Workflows → Import
   from File). It is deliberately not in the skill's `workflows/` folder, so no
   install or deploy will ever pick it up.
3. Select **Execute workflow**.
4. Open the last node, **What The Spike Found**, and copy the `summary` value.

That text is the answer. It names the outcome, every endpoint's status code, the
report's actual column names, one real data row, and the tax types your
organisation has.

## It only reads

Every request in it is a GET. There is no create, update or delete anywhere,
and it uses the read-only credential, so the worst it can do is fail.

## If it says outcome B

The plan's §3.2 lists the deltas. In short: drop `108`, the `Xero (read-write)`
credential, policy rule 6 and its policy entry, and change `105` to queue the
unreconciled bank transactions and unpaid invoices directly instead of parsing
the statement report.

## Afterwards

Delete the workflow from n8n. It has served its purpose, and leaving a spike
lying around in a learner's copy is how a spike becomes a feature nobody meant
to ship.
