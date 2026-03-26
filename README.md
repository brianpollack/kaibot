# Protovate KaiBot /ˈkaɪ.bɒt/ or Kye-Baht

## Background

This project is based on the Clause Agent SDK and provides tools to help
manage AI features for a project.

## Download

[Download Here](https://github.com/brianpollack/kaibot/releases)

## Usage

Set required environment variables before running:

```bash
export ANTHROPIC_API_KEY=your_key_here
export KAI_MODEL=claude-opus-4-6   # optional, this is the default
export LINEAR_API_KEY=lin_api_key_here   # optional, enables Linear mode
export LINEAR_TEAM_KEY=KAIBOT            # optional, Linear team key/name
export OPENROUTER_API_KEY=sk-or-...      # optional, enables OpenRouter provider
export OPENROUTER_MODEL=z-ai/glm-5-turbo # optional, default OpenRouter model
```

You can also place these in `<project>/.env`. KaiBot loads the target project's `.env` automatically.

### Running the bot

| Command                                      | Description                                                                      |
|----------------------------------------------|----------------------------------------------------------------------------------|
| `npm run bot -- /path/to/project`            | Watch Linear issues (when configured) or `features/` `.md` files                 |
| `npm run local`                              | Same as `bot` but targets the current directory (`.`)                            |
| `npm run feature -- Add user authentication` | Create a Linear issue (when configured) or feature file with AI review           |
| `npm run models`                             | List available models (loads `.env`; pass `-- openrouter` for OpenRouter models) |
| `npm run testOpenrouter`                     | Spawn an OpenRouter agent, ask "Tell me about yourself", and print the result    |
| `npm run dev`                                | Run the dev entry point (`src/index.ts`) via tsx                                 |
| `npm start`                                  | Run the compiled bot from `dist/index.js` (requires a build)                     |

### Development

| Command             | Description                         |
|---------------------|-------------------------------------|
| `npm run build`     | Compile TypeScript to `dist/`       |
| `npm run typecheck` | Type-check without emitting files   |
| `npm run lint`      | Run ESLint across `src/`            |
| `npm run lint:fix`  | Run ESLint with auto-fix            |
| `npm run format`    | Prettier-format all files in `src/` |

### Testing

| Command              | Description                                         |
|----------------------|-----------------------------------------------------|
| `npm test`           | Run all unit tests (vitest, single pass)            |
| `npm run test:watch` | Run tests in watch mode                             |
| `npm run test:real`  | Run real end-to-end smoke test against the live API |

Run a single test file:

```bash
npx vitest run src/__tests__/feature.test.ts
```


