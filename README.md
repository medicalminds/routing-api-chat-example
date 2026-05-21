# Routing API Chat Example

This is a small command-line app that shows how to build a chat experience on top of the Routing API.

It is meant to be read, run, and copied from. It is not a full product UI, and it does not contain clinical routing rules. Your app owns the conversation screen and any model you bring. The Routing API owns the routing session: it tells you what to ask next, when the conversation is resolved, and what target or outcome was selected.

The whole loop is:

1. Start a session with your API key, target system, interpreter mode, and any facts you already know.
2. Show the user the API's next action.
3. Send the user's next answer, or send structured JSON from your own model.
4. Repeat until the API returns a resolved outcome, a handoff, an error, or a final message.

The only state you need to carry between calls is the `sessionToken` returned by the API. Treat it as an opaque string. Store it for the active conversation, send it back on the next turn, and do not parse it.

## Quick Start

You need Node.js 22.12 or newer.

```sh
npm install
cp .env.example .env
```

Edit `.env` and set:

```sh
ROUTING_API_BASE_URL=https://your-routing-api.example.com/api
ROUTING_API_KEY=your-key-here
```

Then run:

```sh
npm start
```

You can also pass values as flags instead of using `.env`:

```sh
npm start -- \
  --base-url https://your-routing-api.example.com/api \
  --api-key your-key-here \
  --mode byo \
  --target-system symptomscreen
```

If you provide a value in `.env` or through a flag, the CLI uses it directly. If something is missing, the CLI asks for it.

## What This Demonstrates

The example includes both interpreter modes supported by the chat API.

In `managed` mode, the client sends patient or caregiver text to the Routing API. The API handles the text interpretation and returns the next action. This is the simplest client integration when your Routing API deployment is configured for managed interpretation.

In `byo` mode, short for "bring your own model," patient or caregiver text stays in your app. When the API needs model work, it returns an `llmTask` with a prompt, a response schema, and a `resultField`. You run that prompt in your own model workflow, paste or produce JSON that matches the schema, and send that JSON back under the exact field named by `resultField`.

That means BYO mode does not require your app to invent API request shapes. The API tells you what structured answer it needs for the current turn.

## API Shape

Start a session:

```http
POST /routing/sessions
```

The start request includes your API key as `organizationKey`:

```json
{
  "organizationKey": "your-key-here",
  "targetSystem": "symptomscreen",
  "interpreterMode": "byo",
  "knownFacts": {
    "dateOfBirth": "1990-01-01",
    "sexAssignedAtBirth": "female",
    "relationshipToPatient": "self"
  }
}
```

Continue a session:

```http
POST /routing/turns
```

Every turn includes the latest `sessionToken`:

```json
{
  "sessionToken": "opaque-token-from-the-previous-response",
  "message": {
    "text": "My throat hurts."
  }
}
```

The response always includes a new `sessionToken` and a `nextAction`. The action type tells your client what to do next:

| Action | What your app should do |
| --- | --- |
| `ask` | Show the question and collect the next answer. |
| `say` | Show the message. |
| `resolved` | Show the target or screening outcome. The chat is done. |
| `handoff` | Show the handoff message and urgency. The chat is done. |
| `error` | Show the error message and decide whether to retry. |

## Configuration

The CLI understands these environment variables:

| Variable | Purpose |
| --- | --- |
| `ROUTING_API_BASE_URL` | Base URL for the API, usually ending in `/api`. |
| `ROUTING_API_KEY` | API key used as `organizationKey` when starting a session. |
| `ROUTING_TARGET_SYSTEM` | `symptomscreen` or `cleartriage`. |
| `ROUTING_INTERPRETER_MODE` | `managed` or `byo`. |
| `ROUTING_DATE_OF_BIRTH` | Optional known fact, `YYYY-MM-DD` or `MM/DD/YYYY`. |
| `ROUTING_SEX_ASSIGNED_AT_BIRTH` | Optional known fact: `female`, `male`, or `unknown`. |
| `ROUTING_RELATIONSHIP_TO_PATIENT` | Optional known fact, such as `self`, `parent`, or `caregiver`. |
| `ROUTING_MANAGED_INITIAL_TEXT` | Optional first message for managed mode. |

The older name `ROUTING_ORGANIZATION_KEY` also works if your environment already uses that term.

## Commands During A Session

Type `:help` while the CLI is waiting for input to see available commands.

Useful commands:

| Command | What it shows or sends |
| --- | --- |
| `:history` | Redacted request and response history. |
| `:request` | Last request with credentials redacted. |
| `:response` | Last response with credentials redacted. |
| `:curl` | A runnable curl command for the last request. It includes the current key or session token. |
| `:prompt` | The active BYO model prompt. |
| `:schema` | The active BYO response schema. |
| `:option 1` | Sends the first listed option directly. |
| `:number 3` | Sends a numeric answer directly. |
| `:date 2026-05-20` | Sends a date answer directly. |
| `:unresolved` | Sends an unresolved structured answer for the current question. |

For single-select questions, you can usually type the option number, the option id, or the visible label.

## Reading The Code

The project is intentionally small:

| File | Why it exists |
| --- | --- |
| `src/client.js` | Tiny HTTP client for `POST /routing/sessions` and `POST /routing/turns`. |
| `src/flow.js` | Helpers for flags, known facts, BYO prompts, structured answers, history, and curl output. |
| `src/cli.js` | The interactive command-line app. |
| `test/flow.test.js` | Focused tests for the reusable flow helpers. |

If you are building a real application, `src/flow.js` is the best place to start. It shows the data you send for each kind of turn without mixing that logic into terminal input handling.

## Try The BYO Flow

Run:

```sh
npm start -- --mode byo --target-system symptomscreen
```

When the API asks for symptoms, type a caller message such as:

```text
My throat hurts.
```

The CLI prints the model prompt and JSON schema returned by the API. In a real app, you would send that prompt to your own model. In this terminal example, paste the JSON result back into the CLI. The CLI sends only the structured field requested by `llmTask.resultField`.

For later yes/no screening questions, you can choose the direct option number instead of using a model. For example, type `2` for `No` when the choices are shown as:

```text
1. Yes (yes)
2. No (no)
```

## Testing

```sh
npm test
```

The tests do not call the live Routing API. They verify the reusable request-building and BYO helper behavior.

## Troubleshooting

If the CLI says the API returned an unexpected response, check that your base URL is correct and includes the API prefix your deployment expects.

If the API rejects the start request, check that `ROUTING_API_KEY` is set to the key you were given.

If managed mode stops after setup turns, your Routing API deployment may not be configured for managed text interpretation. BYO mode is a good way to test the same chat flow while keeping model calls in your own environment.

