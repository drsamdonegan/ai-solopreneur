# Cloud deployment

**Status: the deploy path works and the chat is behind a passcode.** The
remaining work is convenience, not safety — see
[Still to do](#still-to-do).

Running the agent in the cloud gives it one thing the local install can never
have: a permanent web address that is awake when the learner is not. That is
what lets an inbox or a schedule start a workflow on its own.

Nothing here changes the local install. `npm start` still runs the same three
services natively through `scripts/local.mjs`, and **no learner needs Docker
installed**. The hosting platform reads the `Dockerfile` and builds the image
on its own servers.

## What was added

| File | Purpose |
| --- | --- |
| `Dockerfile` | Two-stage build. Installs the C++ toolchain that `sqlite3` and `isolated-vm` need, installs n8n on its own cached layer, compiles the chat app, drops dev dependencies. |
| `.dockerignore` | Keeps `data/`, `backups/`, `.env` and `.runtime/` out of the image. Private learner state must only ever arrive on the volume. |
| `railway.json` | Dockerfile build, `/health` check, restart on failure, sleeping disabled, and watch patterns so a docs-only commit does not trigger a rebuild. |
| `scripts/cloud.mjs` | The cloud supervisor. Run with `npm run start:cloud`. |
| `apps/chat/src/access.ts` | The passcode gate. Inert unless a passcode is configured. |
| `scripts/agent-pack.mjs` | The encrypted pack format, shared by the writer and the reader. |
| `scripts/pack-agent.mjs` | `npm run pack` — writes a pack from a local install. |
| `scripts/cloud-setup.mjs` | The first-run page that receives a pack in the cloud. |
| `scripts/cloud-workflows.mjs` | Imports and publishes the reviewed workflows on a deploy. |

`scripts/local.mjs` is untouched and shares no code with the cloud runner, so a
change to one cannot break the other.

## Why the cloud runner is separate

The local runner detaches its services, writes PID files and hands the terminal
back. A container needs the opposite of all three:

- **Foreground.** The platform watches one process; if it exits, the container
  restarts. `cloud.mjs` stays in front and never detaches.
- **Logs on stdout.** Every child's output is streamed with a `[n8n  ]`,
  `[chat ]` or `[docs ]` prefix so the platform's log viewer shows all three.
- **All-or-nothing.** If any service dies, the supervisor shuts the other two
  down cleanly and exits non-zero. A half-working agent is much harder for a
  learner to diagnose than a restart.
- **Graceful stop.** `SIGTERM` from a redeploy stops chat first and n8n last,
  giving an in-flight run a chance to finish before the database closes.

## Two ports, two addresses

The service listens on two public ports, and each needs its own domain:

| Port | What it is | Call it |
| --- | --- | --- |
| 3000 | Chat interface (and the health check) | "my agent" |
| 5678 | n8n editor and every webhook | "my workshop" |

This mirrors the two localhost ports learners already know.

A single address was tested and rejected. With `N8N_PATH=/n8n/`, n8n advertises
its editor under the prefix but keeps `/rest`, `/webhook`, `/healthz`, `/assets`
and `/` at the root — `/n8n/rest/login` returns the SPA's HTML while
`/rest/login` returns the real 401. Routing one domain to both services would
need a hand-maintained allowlist of n8n's root paths, and an n8n upgrade adding
a new one would break triggers silently.

Internal traffic never leaves the container: the task broker and the document
reader stay bound to `127.0.0.1`, and the chat app reaches n8n over loopback.

## Deploying

1. Sign in to Railway with GitHub.
2. **New Project → Deploy from GitHub repo**, and choose the learner's own fork.
3. Wait for the first build. It takes several minutes because n8n is large;
   later builds reuse the cached layer and are much faster.
4. **Settings → Volumes → Add Volume**, mount path exactly `/data`.
5. **Settings → Networking → Generate Domain**, target port `3000`.
6. **Generate Domain** again, target port `5678`.
7. Add two variables:
   - `N8N_PUBLIC_URL` — the port-5678 address.
   - `AGENT_PASSCODE` — at least 8 characters, not reused from anywhere else.
8. Redeploy.

Railway deploys whichever branch is connected, so a learner whose branches are
not merged can point it at their working branch instead of `main`.

### The one variable, and why it exists

`RAILWAY_PUBLIC_DOMAIN` reports only one domain, and a service with two has no
way to say which. Guessing wrong would give n8n the chat address, and every
webhook address it prints — the ones learners give to external services — would look
correct and never fire. The runner therefore asks for `N8N_PUBLIC_URL`
explicitly and refuses to start without it, rather than starting wrong.

It falls back to `/data/config/public-urls.json`, so the planned first-run setup
screen can write both addresses and remove this step entirely.

Everything else is derived: host, protocol, editor base URL, `WEBHOOK_URL`,
proxy hops, secure cookies, execution pruning and all data paths.

> Note: the local runner sets `N8N_WEBHOOK_URL`, which n8n does not read. The
> variable n8n actually uses is `WEBHOOK_URL`, which is what the cloud runner
> sets. Worth correcting in `local.mjs` separately.

## The passcode

n8n ships an owner login. The chat app had nothing at all, and on a public
address that meant anyone who found the URL could talk to the agent, read every
saved conversation and business fact, and spend the learner's Anthropic credit.

`AGENT_PASSCODE` closes that. The gate sits above every route except `/health`,
so the platform's health check keeps working while nobody is signed in, and no
route added later can forget to check.

What it does:

- Signing in sets an `HttpOnly`, `Secure`, `SameSite=Lax` cookie, signed with
  HMAC-SHA256 and valid for 30 days. Tampering with the expiry invalidates it.
- The signing secret is generated on first boot and kept at
  `/data/config/session-secret` (mode `0600`), so a redeploy does not sign the
  learner out. Nobody has to set it.
- Passcodes are compared by hashing both sides first, so the comparison is
  constant-time regardless of length.
- Every wrong guess costs 400 ms. After three, lockouts start at 5s and climb
  to 5 minutes. A quiet 15 minutes clears the tally, so a learner who mistypes
  occasionally never meets the long lockout.
- Rate limiting keys on the address the platform's proxy appended, not the
  client-supplied left-most `X-Forwarded-For` entry, which anyone could vary to
  sidestep the lockout.
- People get the passcode page; scripts get `401` with a JSON body.

Forgotten passcode: change `AGENT_PASSCODE` in the dashboard and redeploy.
There is no reset email and no account to recover — deliberately, because
adding either means adding an identity system to a single-user tool.

**This is one shared passcode, not an identity system.** It is the right size
for one person protecting one agent, and it is not a substitute for real
accounts if the agent ever has more than one user.

## Moving an agent to the cloud

A learner's credentials are AES rows inside n8n's SQLite database, and the key
that opens them is a 32-character string in a file beside it. So the honest way
to move an agent is to move those two things — not to retype four API
credentials into a cloud n8n, and not to paste keys into a hosting dashboard,
which teaches exactly the wrong habit.

**On their computer:** `npm run pack`, or the `pack-agent` double-click helper.

It writes one encrypted file to `backups/`. The agent can stay running: both
databases are copied with SQLite's own `VACUUM INTO`, which takes a consistent
snapshot mid-write, so nothing has to be stopped.

It carries the n8n database, the encryption key, the chat history and business
memory, the profile, and the skills folder. It deliberately leaves execution
history behind — that is a log of runs that happened on a different machine,
and it is around 90% of the file. On a real install that was 48.8 MB of
database reduced to a **719 KB** upload with every credential and workflow
intact.

**In the cloud:** the first-run page asks for the file, its passphrase, and the
agent passcode. Then the agent starts with everything already in place.

The restore happens in the supervisor *before* n8n or the chat app start.
Nothing has the databases open, so files are written straight into place —
no staging area, no restart, and no moment where a half-restored agent is
serving requests.

### Safety properties

- The pack is encrypted with AES-256-GCM under a scrypt-derived key
  (N=65536), because it contains the key to every credential the learner has.
- Its metadata is readable without the passphrase, so the page can say what a
  file contains before asking for anything. Metadata is authenticated, so
  editing it breaks decryption rather than passing quietly.
- Paths inside a pack are treated as hostile. Anything resolving outside its
  own folder is refused. Verified with a crafted pack containing
  `n8n/../../../../../../tmp/...`.
- **Nothing is written until every path validates.** A pack rejected halfway
  would otherwise leave the agent half-replaced, which is worse than either
  outcome alone.
- Restoring requires the agent passcode, so the first-run page is not an open
  door for anyone who finds the address first.
- The passphrase is never written to disk. The pack is decrypted in memory
  during the request.

To bring a newer pack across later, set `AGENT_RESTORE=1` and redeploy.

## Workflows on a deploy

The reviewed workflows in `n8n/workflows` are the source of truth, so pushing a
change to them changes the running agent. That is what makes "push to main and
it goes live" true for the parts of the agent that are not code.

It does **not** run on every boot. The workflow files are fingerprinted, and an
import happens only when that fingerprint changes. Without this, a learner who
edited a workflow in the n8n editor would silently lose it the next time
anything else caused a redeploy.

Imports always land unpublished, which in the cloud is a silent failure: a
trigger that never fires and reports nothing. So the setup and tool workflows
are published straight after import.

The conversation workflow is treated differently. It is published **only when
an Anthropic credential exists** — which it will, if the learner restored a
pack. Publishing it without one produces an agent that fails on every message,
and that reads as broken rather than as unfinished. When a credential appears
later, the next deploy notices and turns the agent on.

Once n8n is listening, two setup workflows run: one builds the local data
tables, the other syncs the learner's enabled skills from the volume into the
agent.

A failure here is reported and then stepped over rather than being fatal. n8n,
the editor and the credentials are all still worth having.

## Guard rails

The runner refuses to start, with a plain-English explanation, when:

- `/data` is missing or not writable — otherwise every conversation,
  credential and workflow would be erased on the next deploy.
- `N8N_PUBLIC_URL` is not set and cannot be resolved.
- `AGENT_PASSCODE` is missing or shorter than 8 characters — otherwise the
  agent would be open to anyone who found the address.

Skills are seeded onto the volume on first boot only. An existing folder is the
learner's own and is never overwritten by a deploy — necessary because the
profile editor writes `my-business/SKILL.md` back to disk, and at its default
path that would land in the image and be discarded on every redeploy.

## Verified

The image was built and run against n8n 2.30.5 on Node 24.18.0.

Build:

- Completes clean. `sqlite3` and `isolated-vm` resolved to prebuilt binaries
  rather than compiling, so the toolchain in the builder stage is a fallback
  rather than a hard requirement — worth keeping, since a platform or
  architecture without prebuilts would otherwise fail the install outright.
- Image is 3.6 GB, almost all of it n8n. The first deploy is slow; later ones
  reuse the cached n8n layer.

Running in a container, with a volume:

- Cold boot: migrations run, encryption key generated at `/data/n8n/.n8n/config`
  with `0600` permissions, all three health checks pass.
- Container destroyed and recreated on the same volume: no migrations re-run,
  no skills re-seeded, encryption key preserved, ready in 4s.
- Only ports 3000 and 5678 are published. The task broker and document reader
  are not reachable from outside the container.
- n8n advertises the correct public editor address from `N8N_PUBLIC_URL`.
- A service killed mid-run: clear message, clean shutdown of the other two,
  non-zero exit so the platform restarts the container.
- `docker stop`, which sends the same `SIGTERM` a redeploy does: graceful
  shutdown in order, exit code 0, under a second, no orphaned processes.

The passcode gate, tested against a running gateway:

- `/health` answers 200 with no cookie; `/`, `/app.js`, `/api/agents`,
  `/api/conversations`, `/api/business-memory` and `POST /api/chat` are all
  refused.
- Browsers are redirected to the passcode page; scripts get `401` and a JSON
  body.
- Correct passcode sets the cookie and opens the full agent — verified in a
  browser, with every asset and API call loading and no CSP violations.
- Rejected: a tampered expiry with a valid signature, a random signature, a
  missing signature, an expired session, and an empty cookie.
- Lockout engages on the fourth wrong guess and clears on its own.
- **With no passcode set, every route is open exactly as before**, which is
  what a learner's own computer does.

The agent pack, packed from a live install and restored into a fresh volume:

- 18 files, 719 KB. Four credentials, 24 workflows, 42 conversations, 140
  messages and 7 business-memory rows all arrived intact, and the restored
  encryption key matched the original, so the credentials decrypt.
- Refused: the wrong passphrase, a tampered ciphertext, tampered metadata, a
  file that is not a pack, a pack with escaping paths, a restore without the
  agent passcode, and a skip without it.
- After a refused pack, the volume was untouched — no partial write.
- Setup does not run again on the next boot.

Workflows on a deploy:

- First deploy after a restore: 12 workflows imported, 18 published, the
  conversation workflow published because the restored credential was found,
  and the task tables and skills synced. 19 of 24 workflows live.
- Ordinary restart with no repository change: import skipped, ready in 5s.
- A workflow edited in the repository and redeployed: picked up, and the change
  visible in the live agent's own database.

## Learner-facing guides

- [Putting your agent in the cloud](CLOUD_RUNBOOK.md) — the deploy walkthrough
  and the triage table for when it goes wrong.

## Still to do
- Dropping container privileges. The image runs as root so that a
  platform-mounted volume is always writable; hardening this needs the mount
  chowned first.

## Cost

Measured in the running container, idle: **551 MB total**, CPU under 1%.
Individually, n8n 363 MB, task runner 108 MB, document reader 90 MB, chat
61 MB, supervisor 76 MB before its heap was capped.

At Railway's $10/GB-month for memory and $20/vCPU-month, that is about $5.50 of
memory plus a small amount of CPU and $0.15 for a 1 GB volume, so **roughly
US$6–9 per month** once the Hobby plan's $5 credit is applied. Confirm against
a real 48-hour bill before quoting a number to learners. Anthropic API usage is
separate and theirs.

Railway's Free plan caps a service at 0.5 GB, so this stack cannot run on it.
Set a usage limit in the Railway dashboard so a runaway workflow cannot produce
a surprise bill.

Do not enable serverless sleeping. Railway wakes a slept service on inbound
traffic but may return 502 on that first request, which can drop the first
webhook of the day.
