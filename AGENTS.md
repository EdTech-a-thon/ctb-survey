# EdTech-a-thon Agent Instructions

This project is a pototype to be completed during the 3-day "EdTech-a-thon" event by a team with varying technical expertise. To ensure that teams are organizing their code similarly, we have some preferred conventions.

- All code belongs in a git repo at `~/code` aka `/home/exedev/code`
- Every project is a sub-directory within `~/code`. Make `~/code` be a `bun` workspace only if the monorepo contains _multiple JS projects_.

## General Instructions

- Write simple code
- Choose a simple tech stack
- Don't install dependencies for features that can be implemented in under 400 lines of code
- Write code that newcomers can understand
- Write code that is self-documenting
- If the product requirements are unclear, ask the human instead of guessing
- You are building a high-fidelity prototype

## Communication Style

When communicating with the user, speak in a style and tone that is appropriate for both developers and educators who are not developers. Explain your reasoning clearly and simply. Use jargon only when it is more helpful than simple language.

## Live Dev Server

You are running on a live dev server. A proxy is in place that routes external traffic to port `8000`.

When you are building an app for a user, you should make sure that it is continuously running in dev mode on port `8000`, even if the user does not ask you to start the server.

Your server might receive traffic from hostnames at _.exe.xyz or _.edtechathon.com. If you are running a vite-powered server, your vite config should include the following:

```
{
  server: {
    allowedHosts: [".exe.xyz", ".edtechathon.com"]
  }
}
```

## Things to Do Regularly

Before/after every change, consider doing the following things if appropriate:

### Commit and push to GitHub

- When a small self-contained chunk of work has been completed, automatically create a commit with a reasonable message
- When larger chunks of work have been completed (such as new features or major bug fixes), offer to push the code to GitHub for the user. (Be sure to describe this offer in language that is understandable to both experienced and inexperienced developers.)

### Check Types and Linting

- Run any available type checkers and linters periodically to validate code

## Tech Stack Choices

When making choices about the tech stack to use, prefer these choices in priority order:

1. Technology choices specified by the human
2. Continue using technology that already exists in the project
3. Technology choices that are most sensible for the constraints or needs of the project
4. When in doubt or when there is no best option, prefer the choices recommended in the default tech stacks listed below
5. If a default is not specified, prefer simple, standard technology choices that are easy for newcomers to understand and contribute to

### Default Web App Tech Stack

When the human has not specified a choice and there is no particular benefit to one option over another, default to the following for the sake of cross-team consistency:

- Runtime: Bun
- Package manager: Bun
- Language: Typescript
- Build tool: Vite-based tooling
- Linter: ESLint (for JS/TS projects)
- Formatter: Prettier (for JS/TS projects; by default, create a blank prettier config file that does not modify any settings)
- Framework: SvelteKit if using Svelte or Astro if not
- UI Library: Svelte
- UI / Styling: Tailwind CSS
- UI Rendering Method: Prefer DOM elements over canvas when possible for the sake of accessibility, using canvas only when it is unreasonable not to
- Database: Prefer localStorage if user accounts or persistence are not strictly necessary, otherwise SQLite
- ORM: Drizzle (only if needed)

When appropriate, set up scripts in `package.json` for type checking, linting, and formatting code automatically via the CLI.

### When Not to Build a Web App

- If the user requests to build a **browser extension**, explain that this VM is not the best way to do that, and recommend that they ask an EdTech-a-thon Director about alternative templates.
- If the user requests to build a native desktop or mobile app, explain that this template is for building web apps only, and collaborate with the user to determine the relevant product requirements and decide whether or not a web app is appropriate. Prefer building as a web app if possible. If the product requirements require a native app, reccomend that the user ask an EdTech-a-thon Director for assistance.
