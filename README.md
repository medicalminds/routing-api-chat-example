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

If the base URL, API key, target system, or interpreter mode is missing, the CLI asks for it before starting the session. It does not ask for patient relationship, date of birth, sex assigned at birth, or an initial managed-mode caller message during setup. If you already know those facts, provide them in `.env` or through flags. Otherwise the example starts the Routing API session immediately, shows the first patient assessment question, and lets the API ask for those facts later only if the routing flow needs them.

## What This Demonstrates

The example includes both interpreter modes supported by the chat API.

In `managed` mode, the client sends patient or caregiver text to the Routing API. The API handles the text interpretation and returns the next action. This is the simplest client integration when your Routing API deployment is configured for managed interpretation.

In `byo` mode, short for "bring your own model," patient or caregiver text stays in your app. When the API needs model work, it returns an `llmTask` with a prompt, a response schema, and a `resultField`. You run that prompt in your own model workflow, paste or produce JSON that matches the schema, and send that JSON back under the exact field named by `resultField`.

That means BYO mode does not require your app to invent API request shapes. The API tells you what structured answer it needs for the current turn.

The example can also demonstrate the optional SymptomScreen decision-tree payload. Start it with `--decision-tree` or `--decision-tree=inline` to request the tree in normal session and turn responses. Start it with `--decision-tree=fetch` to demonstrate the dedicated `POST /routing/decision-tree` endpoint instead. Your organization key must have `GetDecisionTree` access. Once the session reaches SymptomScreen screening, the CLI loads the selected tree and lets you try local traversal with commands such as `:tree`, `:tree no`, or `:tree unsure`.

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
  "interpreterMode": "byo"
}
```

If your app already has patient facts before the chat begins, you can send them as `knownFacts`. The command-line example only includes this object when you provide the facts through flags or environment variables:

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

Send setup facts only on `POST /routing/sessions`. Do not send `knownFacts` on follow-up turns; the API rejects follow-up setup facts so the patient context cannot silently change after the session starts. When the caller corrects a collected setup fact or symptom summary, use the intake-review correction flow returned by the API.

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

Fetch the selected SymptomScreen decision tree after screening is reached:

```http
POST /routing/decision-tree
```

The request body is just the current session token:

```json
{
  "sessionToken": "opaque-token-from-the-previous-response"
}
```

The response body contains the selected public tree:

```json
{
  "decisionTree": {
    "schemaVersion": "symptomscreen-decision-tree.v1",
    "targetSystem": "symptomscreen",
    "targets": [],
    "initialCursor": {
      "nodePath": [],
      "questionIndex": 0,
      "questionId": 501
    },
    "nodes": [
      {
        "type": "question",
        "source": "main_screening",
        "questions": [
          {
            "id": 501,
            "text": "Do they have trouble breathing?"
          }
        ]
      },
      {
        "type": "outcome",
        "outcome": {
          "id": 1,
          "acuity": 1,
          "name": "Go now",
          "text": "Go now"
        }
      },
      null,
      null,
      {
        "type": "outcome",
        "outcome": {
          "id": 7,
          "acuity": 7,
          "name": "Home care",
          "text": "Home care"
        }
      },
      null,
      null
    ]
  }
}
```

This endpoint requires `GetDecisionTree` access on the organization key that started the session. You can also ask for the tree inline by sending `responseOptions.includeDecisionTree: true` on `POST /routing/sessions` and follow-up `POST /routing/turns`. In this CLI, pass `--decision-tree` or `--decision-tree=inline` for inline mode. Pass `--decision-tree=fetch` when you want the example to call the dedicated endpoint instead.

Session responses from `POST /routing/sessions` and `POST /routing/turns` include a new `sessionToken` and a `nextAction`. The action type tells your client what to do next:

| Action     | What your app should do                                 |
| ---------- | ------------------------------------------------------- |
| `ask`      | Show the question and collect the next answer.          |
| `say`      | Show the message.                                       |
| `resolved` | Show the target or screening outcome. The chat is done. |
| `handoff`  | Show the handoff message and urgency. The chat is done. |
| `error`    | Show the error message and decide whether to retry.     |

For `ask` actions, use `nextAction.question.text` as the prompt to speak or render. `helperText` and `options` are optional because some questions are free-text prompts and some are fixed-choice prompts. The intake review checkpoint uses `question.id = "pre_routing.intake_review"` or `"pre_routing.intake_review_repair"` and includes `question.reviewSummary.parts`, which is a structured list of the facts and concerns being confirmed. Older mappers may also see `question.questionText`, `question.suggestedText`, `helperText: null`, and `options: []` on these intake review questions; those fields are compatibility aliases around the canonical `question.text` and `question.reviewSummary` data.

## Configuration

The CLI understands these environment variables:

| Variable                          | Purpose                                                                             |
| --------------------------------- | ----------------------------------------------------------------------------------- |
| `ROUTING_API_BASE_URL`            | Base URL for the API, usually ending in `/api`.                                     |
| `ROUTING_API_KEY`                 | API key used as `organizationKey` when starting a session.                          |
| `ROUTING_TARGET_SYSTEM`           | `symptomscreen` or `cleartriage`.                                                   |
| `ROUTING_INTERPRETER_MODE`        | `managed` or `byo`.                                                                 |
| `ROUTING_INCLUDE_DECISION_TREE`   | Optional. Use `true`, `inline`, or `fetch` to demonstrate the selected SymptomScreen tree. |
| `ROUTING_DEBUG_MANAGED_INTERPRETATION` | Optional. Defaults on; use `false` to skip the managed-interpretation debug header. |
| `ROUTING_DATE_OF_BIRTH`           | Optional known fact, `YYYY-MM-DD` or `MM/DD/YYYY`.                                  |
| `ROUTING_SEX_ASSIGNED_AT_BIRTH`   | Optional known fact: `female`, `male`, or `unknown`.                                |
| `ROUTING_RELATIONSHIP_TO_PATIENT` | Optional known fact, such as `self`, `parent`, or `caregiver`.                      |
| `ROUTING_MANAGED_INITIAL_TEXT`    | Optional first message for managed mode.                                            |

The older name `ROUTING_ORGANIZATION_KEY` also works if your environment already uses that term.

The optional patient facts are prefilled facts, not startup prompts. Leaving them unset gives the Routing API control over whether and when to ask for them during the actual assessment.

## Commands During A Session

Type `:help` while the CLI is waiting for input to see available commands.

Useful commands:

| Command            | What it shows or sends                                                                      |
| ------------------ | ------------------------------------------------------------------------------------------- |
| `:history`         | Redacted request and response history.                                                      |
| `:request`         | Last request with credentials redacted.                                                     |
| `:response`        | Last response with credentials redacted.                                                    |
| `:curl`            | A runnable curl command for the last request. It includes the current key or session token. |
| `:prompt`          | The active BYO model prompt.                                                                |
| `:schema`          | The active BYO response schema.                                                             |
| `:tree`            | Shows the synchronized local decision-tree helper state after the tree is loaded.           |
| `:tree no`         | Previews a clean-no branch locally without sending an API turn.                             |
| `:tree maybe`      | Previews the safety-positive branch locally without sending an API turn.                    |
| `:option 1`        | Sends the first listed option directly.                                                     |
| `:number 3`        | Sends a numeric answer directly.                                                            |
| `:date 2026-05-20` | Sends a date answer directly.                                                               |
| `:unresolved`      | Sends unresolved for route questions, or `unclear` for SymptomScreen screening questions.   |

For single-select questions, you can usually type the option number, the option id, or the visible label.

## Decision Tree Helper

The file [src/decision-tree.js](./src/decision-tree.js) is deliberately standalone. It has no dependency on the CLI, no dependency on the HTTP client, and no dependency on a framework. If your app is plain JavaScript, copy that file into your project and pass it the `decisionTree` object returned after requesting `responseOptions.includeDecisionTree` or calling `POST /routing/decision-tree`. This example package is private, but it also exposes `routing-api-chat-example/decision-tree` so workspace consumers can import the same standalone helper without reaching into the `src` directory.

The helper deserializes the public pre-order `nodes` array with `null` missing-child sentinels, starts at `decisionTree.initialCursor` when the API includes one, creates a cursor over the tree, and applies the SymptomScreen safety rule. SymptomScreen guide questions expect a clean yes or no. The helper accepts `yes`, `no`, `maybe`, `unsure`, and `unclear`, normalizing casing and surrounding whitespace. `yes`, `maybe`, `unsure`, and `unclear` go to the safety-positive left branch. A clean `no` advances to the next question in the same question node when one exists. Only a clean `no` to the last question in that node goes to the no/right branch.

Keep using `nextAction.question.text` as the prompt you show or speak to the caller. The tree is for local traversal state and may start after the root when the API has already skipped or auto-answered earlier screening questions.

The helper models local branch safety only. Server-authoritative traversal through `POST /routing/turns` may still return another `ask` action before advancing, such as when the caller answer is `unclear` and the API chooses to re-ask once before taking the safety-positive branch.

```js
import { createDecisionTreeCursor } from './src/decision-tree.js';

const cursor = createDecisionTreeCursor(decisionTree);

while (cursor.current()?.type === 'question') {
  const answer = await collectAnswerFromYourUi(cursor.current().questions);
  cursor.answer(answer);
}

console.log(cursor.current().outcome.text);
```

That local traversal is optional and independent from the active Routing API session. The safest and simplest integration remains server-authoritative traversal through `POST /routing/turns`; the helper is for consumers that specifically need the full selected tree in their own app.

## Reading The Code

The project is intentionally small:

| File                         | Why it exists                                                                                            |
| ---------------------------- | -------------------------------------------------------------------------------------------------------- |
| `src/client.js`              | Tiny HTTP client for `POST /routing/sessions`, `POST /routing/turns`, and `POST /routing/decision-tree`. |
| `src/decision-tree.js`       | Copyable standalone helper for traversing a selected SymptomScreen decision tree.                        |
| `src/flow.js`                | Helpers for flags, known facts, BYO prompts, structured answers, history, and curl output.               |
| `src/cli.js`                 | The interactive command-line app.                                                                        |
| `test/flow.test.js`          | Focused tests for the reusable flow helpers.                                                             |
| `test/decision-tree.test.js` | Focused tests for the copyable decision-tree helper.                                                     |
| `test/cli-smoke.test.js`     | End-to-end CLI smoke tests against a local mock Routing API.                                             |

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

The tests do not call the live Routing API. They verify the reusable request-building helpers, the decision-tree helper, and a CLI smoke flow against a local mock HTTP server.

## Troubleshooting

If the CLI says the API returned an unexpected response, check that your base URL is correct and includes the API prefix your deployment expects.

If the API rejects the start request, check that `ROUTING_API_KEY` is set to the key you were given.

If managed mode stops after setup turns, your Routing API deployment may not be configured for managed text interpretation. BYO mode is a good way to test the same chat flow while keeping model calls in your own environment.
