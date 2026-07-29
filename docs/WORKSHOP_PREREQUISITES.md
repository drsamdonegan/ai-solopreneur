# Workshop Prerequisites

## Outcome

Complete this checklist before the main workshop. A learner who completes it should arrive with Claude Desktop, access to the repository, and a usable Claude API key. The project runtime is prepared automatically during setup.

Install Claude Desktop and GitHub Desktop before the session. Node.js, n8n, and the chat build tools are handled inside the project.

## Required accounts

### GitHub

- Create or sign in to a GitHub account.
- Confirm that the learner can create a repository.
- Install GitHub Desktop as the default workshop Git workflow.
- Confirm that GitHub Desktop can sign in to the learner's account.
- Practise creating a repository from a template and cloning it.

### Anthropic Console

- Create or sign in to an Anthropic Console account.
- Add API credit or otherwise confirm API access.
- Create a Claude API key.
- Store the key in a password manager or another private location.
- Do not paste the key into a chat message, repository, screenshot, shared document, or frontend configuration.

The key will be added to n8n during the workshop.

## Required software

- **Claude Desktop**, signed in with the Code area available.
- **GitHub Desktop**, signed in for the visual save-and-push workflow.
- A current Chrome or Edge browser.
- At least 6 GB of free disk space for first setup; 8 GB is recommended.

Node.js and npm do not need manual installers. Setup uses an existing runtime
only when it is the exact reviewed Node.js 24.18.0 and npm 11.16.0 pair.
Otherwise it downloads the pinned official Node.js archive, checks its SHA-256
fingerprint, and unpacks the pair into this project's private `.runtime/`
folder. Nothing is installed globally and no administrator access or restart is
needed.

### macOS

- macOS 13 or newer.
- Current Chrome or Edge.
- Claude Desktop installed and signed in.
- GitHub Desktop installed and signed in.

Both Apple Silicon and Intel are target environments and must be represented in preflight testing when available.

### Windows

- Windows 10 or 11 on an x64 computer; or Windows 11 on an ARM-based computer.
- Current Chrome or Edge.
- Claude Desktop installed and signed in.
- GitHub Desktop installed and signed in.

On Windows 11 ARM laptops, including Snapdragon devices, setup deliberately
uses the reviewed x64 runtime through Windows' built-in emulation because the
pinned n8n native packages do not provide all required Windows ARM64 binaries.
Windows 10 on ARM is not supported. WSL2, Hyper-V, BIOS virtualization settings,
Visual Studio build tools, and Python are **not** required.

Keep the repository in a short local folder such as
`C:\ai-workshop\ai-solopreneur`. Do not run it inside OneDrive, from a
network/UNC path such as `\\server\share`, or from inside a ZIP. Cloud sync and
network filesystems can lock or mis-handle the large native dependency install.

## Network requirements

The learner's network must permit:

- Downloading the pinned runtime from `nodejs.org`.
- Downloading npm packages from `registry.npmjs.org`.
- Downloading the SheetJS package asset from `cdn.sheetjs.com`.
- Downloading prebuilt native package assets from
  `release-assets.githubusercontent.com`.
- Accessing GitHub.
- Accessing the Anthropic API.

Opening the npm website in a browser is not enough: the package registry and
asset hosts above must all be allowed. VPN, proxy, TLS-inspection certificate,
firewall, managed-device, or campus-network restrictions should be discovered
during preflight rather than during the workshop.

## Port check

The local project uses:

- `http://localhost:3000` for the learner chat.
- `http://localhost:5678` for n8n.
- `127.0.0.1:3100` for the internal document reader.
- `127.0.0.1:5679` for n8n's internal task broker. This defaults to one above
  `N8N_PORT` when the n8n port is changed.

The setup and preflight helpers confirm that all required ports are available or
explain how to change them in `.env`.

## Preflight exercise

Before the main workshop, every learner should:

1. Create a private repository from the released template and bring it into
   Claude Code in a supported local folder.
2. On Windows, double-click `preflight-windows.cmd` and resolve every `[!!]`
   result before the large dependency install.
3. Ask Claude Code to read the README and run the documented one-click setup.
   On Windows it should set `AI_SOLO_NO_PAUSE=1` before running the `.cmd`
   launcher.
4. Wait for `Local stack is healthy`.
5. Open [http://localhost:3000](http://localhost:3000) and [http://localhost:5678](http://localhost:5678).
6. Double-click `stop.command` or `stop-windows.cmd`.
7. Sign in to GitHub Desktop.
8. Confirm possession of a private Claude API key with available credit.

Running setup at home also downloads the large npm packages in advance, which protects the workshop from slow venue wifi.

## Instructor preparation

The instructor should use [INSTRUCTOR_CHECKLIST.md](INSTRUCTOR_CHECKLIST.md) and prepare:

- At least one tested macOS machine.
- At least one tested Windows x64 machine; include a Windows 11 ARM laptop when
  the cohort may bring one.
- Screenshots for every setup step.
- A small number of preconfigured backup machines where practical.
- A repository archive and exported n8n workflows.
- A process for helping learners without viewing or copying their API keys.

## Readiness record

Record for each learner:

| Check | Result |
| --- | --- |
| Supported operating system | Pass / needs help |
| 6 GB minimum free; 8 GB recommended | Pass / needs help |
| Short local folder outside OneDrive/UNC | Pass / needs help |
| Reviewed Node.js 24.18.0 + npm 11.16.0 pair prepared | Pass / needs help |
| Windows `preflight-windows.cmd` completed | Pass / needs help |
| `setup.command` / `setup-windows.cmd` completed | Pass / needs help |
| Required local ports available | Pass / needs help |
| GitHub and all four download hosts accessible | Pass / needs help |
| GitHub Desktop access | Pass / needs help |
| Anthropic Console access | Pass / needs help |
| Claude API key and credit | Pass / needs help |
| Local chat page opened | Pass / needs help |

Learners with unresolved installation, account, or network failures should receive support before the main build session.

## Security reminder

API keys are secrets.

- Never commit a key.
- Never add a key to `agent.config.js`.
- Never put a key into browser code.
- Never share a key between teams.
- Rotate a key immediately if it is exposed.

The local architecture is designed so that Claude credentials live only in n8n's encrypted credential store.
