# Customise the Chat

## Outcome

In about five minutes, a learner can give the example chat its own:

- Agent name.
- Short description.
- Welcome message.
- Primary colour.
- Example prompts.

No server code, n8n workflow, API key, or npm command needs to change.

## Open the settings file

Open:

```text
apps/chat/public/agent.config.js
```

The starter file looks like this:

```javascript
window.AGENT_CONFIG = Object.freeze({
  name: "Project Manager",
  subtitle: "Turn meetings, documents, and project ideas into clear next actions.",
  welcomeMessage:
    "Hello! I’m your Project Manager. Add a meeting transcript or tell me what you’re working on, and I’ll help turn it into decisions, plans, and safe next actions.",
  primaryColour: "#6D4AFF",
  examplePrompts: [
    "Turn these meeting notes into decisions and action items",
    "Build a practical project plan from this document",
    "Show me the highest-priority work in my local project",
  ],
});
```

Change the words between the quotation marks. Keep the quotation marks, commas, square brackets, and other punctuation in place.

Save the file, then refresh [http://localhost:3000](http://localhost:3000). The local Compose setup shares this folder with the chat container, so these settings update without rebuilding the image.

## Choose a colour

`primaryColour` accepts a normal web colour. A six-digit hex value is the simplest format:

```javascript
primaryColour: "#126B5D",
```

The leading `#` is required. If a colour is invalid, the page safely falls back to the starter purple.

## Write useful example prompts

Example prompts should show what the agent is meant to help with. Prefer a clear request over a one-word label.

Good:

```text
Turn my launch idea into a one-week action plan
```

Less useful:

```text
Planning
```

Use one to six prompts. Long prompts are shortened in the interface.

## Safe customisation boundary

This file controls presentation only. It cannot add tools or grant the agent access to a service. Agent behaviour belongs in the enabled Markdown skills, while credentials and reviewed project-management workflows belong in n8n. See [CUSTOMISE_SKILLS.md](CUSTOMISE_SKILLS.md).

The interface displays configuration values and agent replies as plain text. It does not execute HTML supplied in a name, prompt, or reply.

## For technical contributors

The browser assets are in `apps/chat/public/`. The small TypeScript gateway is
in `apps/chat/src/`.

Run its contract tests with:

```bash
cd apps/chat
npm ci
npm test
```

Rebuild and restart after changing TypeScript:

```bash
node scripts/local.mjs restart
```

Edits to files in `apps/chat/public/` are visible after a plain browser refresh; they need no rebuild or restart.

Learners can compare the supplied [finished Launch Partner example](../examples/finished-solo-project-assistant/README.md), then use [GitHub Desktop](GITHUB_DESKTOP.md) to commit and push their chosen customisation.
