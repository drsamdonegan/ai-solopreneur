# Domain Research Memory (optional skill)

Point the agent at a website you own. It reads your public home page, works out what your business appears to offer and to whom, suggests who you compete with and what people might search for, and saves all of it on your computer so later conversations can use it without you pasting anything again.

Best for: writing your own marketing copy, sanity-checking how your site reads to a stranger, and getting a first list of search terms to look into properly.

## Before you start

Your site must be **publicly live**. If it is behind a login, a coming-soon page, or a password, the agent cannot read it and will say so rather than guess.

You also need the Anthropic credential you created for workflow `00`. Domain research uses the same one, so there is no second key and no second service to install. Import normally attaches it for you. To check: open n8n, open `50 - TOOL - start_domain_research`, click **Analyse With Claude**, and confirm it shows `Anthropic account`.

## Turn it on

1. Open `skills/enabled.txt` and add this line at the end:

   ```text
   domain-research
   ```

2. Save the file. Do not change any other line in it.
3. Make sure the local app is running, then sync:
   - macOS: double-click `sync-skills.command`
   - Windows: double-click `sync-skills-windows.cmd`
4. Wait for **Enabled skills synced successfully**. This takes up to three minutes on an older laptop, because n8n restarts twice. A long quiet pause is normal.
5. Open the chat and select **New conversation**.

## Try it

Paste this into the chat, with your own domain in place of `yourbusiness.com`:

```text
Please research yourbusiness.com.
```

The agent will ask whether you own the domain or are allowed to research it. That question is deliberate and it will not start until you answer it. Reply:

```text
Yes, I own it and I authorise you to research it.
```

Then **wait**. The research takes up to a minute: it reads your page, analyses it, and saves the result, all in one step. The chat will look idle while that happens. Do not send the message again.

## Check it worked

Look in the reply for these exact characters:

- `Nothing else was crawled`
- `inference`

The first comes from the tool itself, so seeing it proves the research actually ran rather than the agent answering from memory. The second proves the evidence labelling survived.

If you cannot see them, the skill is not loaded: check that `domain-research` is on its own line in `skills/enabled.txt`, with no capital letters and no spaces, then sync again.

## Using it later

Once research is saved, later conversations can use it without re-running anything. In a brand new conversation, try:

```text
From my saved research, draft three blog post titles for my site.
```

The agent reads what was saved rather than starting again. Ask it to re-scan only when your site has actually changed.

## Read the labels

Every competitor it gives you is marked one of two ways, and the difference matters more than the list:

- **page evidence** — that organisation is named on your own page. This is a fact about your page.
- **inference** — it is not on your page. The model suggested it from general knowledge. This is a lead to check, not a finding.

Most competitors come back as inference. That is expected and honest. Treat them as a starting list to verify, never as research you can quote.

## What it will not do

- It reads **one page**: your home page. It is not a crawler and will not follow links into the rest of your site.
- It has **no search engine and no keyword tool**. The seed keywords are suggestions from your page and from general knowledge. They carry **no search volumes and no difficulty scores**, because nothing here can measure those. Take them to a real keyword tool before you plan anything around them.
- It cannot read a site that builds its content with JavaScript after loading. If your page comes back nearly empty, that is usually why, and the result is saved as `partial` with a warning.
- It will not invent a company, a domain, or a statistic to fill a gap. Fewer entries is the intended behaviour.
- It will not research a domain you have not said you are allowed to research, and a link or a document does not count as permission.
- It only researches public business domains. Internal addresses, IP addresses, and `localhost` are refused.

## When something goes wrong

It tells you plainly instead of inventing findings. If you see a message saying the page could not be read, or that the analysis failed, then **nothing was saved** — that is the honest outcome, not a bug to work around. Ask it to try again, or check the site loads for a stranger in a private browser window.

## Where your research is stored

On your computer, in the chat app's local database, alongside your saved conversations. Nothing is uploaded anywhere. The only things that leave your machine are the request to read your own public page and the analysis request to Claude.

## Turn it off

Delete the `domain-research` line from `skills/enabled.txt` and sync again. The folder can stay where it is; anything not listed in `enabled.txt` is ignored. Research already saved stays saved.
