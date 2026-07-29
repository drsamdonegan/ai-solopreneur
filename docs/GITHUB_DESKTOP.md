# Create and Save Your Project with GitHub Desktop

## Outcome

You will create a repository from the AI Solopreneur template, keep a copy on your computer, and safely save your customisations without using a terminal.

## Create your repository from the template

1. Sign in to GitHub in the browser.
2. Open the released AI Solopreneur template repository.
3. Select **Use this template**, then **Create a new repository**.
4. Under **Owner**, select your own account or the workshop organisation.
5. Enter a short repository name such as `studio-project-partner`.
6. Add a description if useful.
7. Select **Private** for workshop or client work.
8. Leave **Include all branches** off.
9. Select **Create repository**.

A repository created from a template is independent. It starts with the finished learner files but not the template's development history or open phase branches.

Do not choose **Fork** for a new learner project. A fork is designed for contributing changes back to the original repository, while a template creates a new project you own.

## Clone it with GitHub Desktop

1. Install and sign in to [GitHub Desktop](https://desktop.github.com/) if it is not already available.
2. In GitHub Desktop, select **File → Clone repository**.
3. Select the **GitHub.com** tab.
4. Search for the repository you just created.
5. Select it.
6. Keep the suggested local path unless the instructor supplied another folder.
7. Select **Clone**.
8. Select **Show in Finder** on macOS or **Show in Explorer** on Windows.

That folder is your project. Run `setup.command` or `setup-windows.cmd` from inside it.

## Save a customisation

After changing the chat or a Markdown skill:

1. Return to GitHub Desktop.
2. Select the **Changes** tab.
3. Review every listed file. `.env`, `backups`, and credentials must never appear.
4. In **Summary**, write a short outcome such as:

   ```text
   Customise my project partner
   ```

5. Select **Commit to main**.
6. Select **Push origin**.

The change is now saved in the learner's GitHub repository. Local n8n users, task rows, execution history, and credentials live in the project's Git-ignored `data/` folder and are not included in a Git commit; use the private backup helper for those.

## Receive a teammate's change

Before editing a shared repository:

1. Open the correct repository in GitHub Desktop.
2. Select **Fetch origin**.
3. If changes are available, select **Pull origin**.
4. Confirm the app still starts before making another change.

Only one learner should edit the same workflow or Markdown skill at a time during the workshop. This avoids a merge conflict that distracts from the agent lesson.

## If a secret appears

Do not commit or push.

1. Uncheck the secret-containing file in GitHub Desktop.
2. Tell the instructor privately.
3. Revoke an exposed Claude API key in the Anthropic Console.
4. Confirm `.env`, `backups/`, and n8n credential exports remain ignored.

The supplied repository rules already ignore local configuration and backup folders. They cannot protect a key pasted into a tracked Markdown, JavaScript, or workflow file.

## GitHub reference

GitHub explains the distinction and current interface in [Creating a repository from a template](https://docs.github.com/en/repositories/creating-and-managing-repositories/creating-a-repository-from-a-template).
