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

Node.js does not need a manual installer. Setup first looks for Node.js 24 or newer. If it is missing or older, setup downloads the pinned official Node.js 24.18.0 archive, checks its SHA-256 fingerprint, and unpacks it into this project's private `.runtime/` folder. Nothing is installed globally and no administrator access or restart is needed.

### macOS

- macOS 13 or newer.
- Current Chrome or Edge.
- Claude Desktop installed and signed in.
- GitHub Desktop installed and signed in.

Both Apple Silicon and Intel are target environments and must be represented in preflight testing when available.

### Windows

- Windows 10 or 11.
- Current Chrome or Edge.
- Claude Desktop installed and signed in.
- GitHub Desktop installed and signed in.

WSL2, Docker Desktop, Hyper-V, and BIOS virtualization settings are **not** required. Learners on ARM-based Windows laptops (for example Snapdragon devices) should complete the preflight exercise early so any platform issue is found before the session.

## Network requirements

The learner's network must permit:

- Downloading packages from registry.npmjs.org.
- Downloading the pinned Node.js archive from nodejs.org when a suitable runtime is not already available.
- Accessing GitHub.
- Accessing the Anthropic API.

VPN, proxy, firewall, managed-device, or campus-network restrictions should be discovered during preflight rather than during the workshop.

## Port check

The local project uses:

- `http://localhost:3000` for the learner chat.
- `http://localhost:5678` for n8n.

The setup and preflight helpers confirm that these ports are available or explain how to change them in `.env`.

## Preflight exercise

Before the main workshop, every learner should:

1. Create a private repository from the released template and bring it into Claude Code.
2. Ask Claude Code to read the README and run the documented one-click setup.
3. Wait for `Local stack is healthy`.
4. Open [http://localhost:3000](http://localhost:3000) and [http://localhost:5678](http://localhost:5678).
5. Double-click `stop.command` or `stop-windows.cmd`.
6. Sign in to GitHub Desktop.
7. Confirm possession of a private Claude API key with available credit.

Running setup at home also downloads the large npm packages in advance, which protects the workshop from slow venue wifi.

## Instructor preparation

The instructor should use [INSTRUCTOR_CHECKLIST.md](INSTRUCTOR_CHECKLIST.md) and prepare:

- At least one tested macOS machine.
- At least one tested Windows machine (include an ARM-based Windows laptop when the cohort may bring them).
- Screenshots for every setup step.
- A small number of preconfigured backup machines where practical.
- A repository archive and exported n8n workflows.
- A process for helping learners without viewing or copying their API keys.

## Readiness record

Record for each learner:

| Check | Result |
| --- | --- |
| Supported operating system | Pass / needs help |
| Project-local Node.js runtime prepared | Pass / needs help |
| `setup.command` / `setup-windows.cmd` completed | Pass / needs help |
| Ports 3000 and 5678 available | Pass / needs help |
| GitHub access | Pass / needs help |
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
