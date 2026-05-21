#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs';
import { stdin as input, stdout as output } from 'node:process';
import { createInterface } from 'node:readline/promises';
import {
  createRoutingApiClient,
  RoutingApiError,
  RoutingInvalidResponseError
} from './client.js';
import {
  DEFAULT_ROUTING_API_BASE_URL,
  ROUTING_ENV,
  buildByoLlmAdvanceRequest,
  buildCompleteByoPrompt,
  buildCurl,
  buildDateAdvanceRequest,
  buildMessageAdvanceRequest,
  buildNumberAdvanceRequest,
  buildOptionAdvanceRequest,
  buildStartSessionInput,
  buildUnresolvedAdvanceRequest,
  historyEntry,
  knownFactsFromValues,
  normalizeDateInput,
  optionIdFromChoice,
  parseDateAnswer,
  parseJsonInput,
  parseNumberAnswer,
  parseRoutingChatCliArgs,
  prettyJson,
  redactCredentials,
  routingChatDefaultsFromEnv,
  selectedGuideTargets,
  targetSystemLabel
} from './flow.js';

const helpText = `Routing API chat example

Usage:
  npm start
  npm start -- --mode byo --target-system symptomscreen
  npm start -- --mode managed --api-key <key> --base-url <url>

Options:
  --base-url <url>                 Routing API base URL. Example: https://routing.example.com/api
  --api-key <key>                  Routing API key. Sent as organizationKey in the start request.
  --target-system <value>          symptomscreen or cleartriage
  --mode <value>                   managed or byo
  --date-of-birth <date>           YYYY-MM-DD or MM/DD/YYYY
  --sex-assigned-at-birth <value>  female, male, or unknown
  --relationship-to-patient <val>  self, parent, caregiver, clinician, and related values
  --managed-initial-text <text>    Optional first caller message for managed mode
  --debug / --no-debug             Request managed-interpretation debug diagnostics

Environment:
  ${ROUTING_ENV.baseUrl}
  ${ROUTING_ENV.apiKey}
  ${ROUTING_ENV.organizationKey}
  ${ROUTING_ENV.targetSystem}
  ${ROUTING_ENV.interpreterMode}
  ${ROUTING_ENV.dateOfBirth}
  ${ROUTING_ENV.sexAssignedAtBirth}
  ${ROUTING_ENV.relationshipToPatient}
  ${ROUTING_ENV.managedInitialText}
`;

const turnHelpText = `Commands while a session is active:
  :help       Show this command list
  :history    Show redacted request and response history
  :request    Show the last request with credentials redacted
  :response   Show the last API response with credentials redacted
  :curl       Show a runnable curl for the last request. It includes the current key or token.
  :debug      Show managed interpretation diagnostics from the last response
  :prompt     Show the active BYO model prompt, when one is available
  :schema     Show the active BYO response schema, when one is available
  :quit       End the CLI session

Direct answer shortcuts:
  :option <id or number>
  :number <value>
  :date <YYYY-MM-DD>
  :unresolved
`;

const setupFields = [
  'baseUrl',
  'dateOfBirth',
  'interpreterMode',
  'managedInitialText',
  'organizationKey',
  'relationshipToPatient',
  'sexAssignedAtBirth',
  'targetSystem'
];

const mergeFlags = (envDefaults, cliFlags) => ({
  ...envDefaults,
  ...Object.fromEntries(
    Object.entries(cliFlags).filter(([, value]) => value !== undefined)
  )
});

const suppliedSetupFields = (...sources) =>
  new Set(
    setupFields.filter(field =>
      sources.some(source => source[field] !== undefined)
    )
  );

const pathForHistoryLabel = label =>
  label === 'Start session' ? '/routing/sessions' : '/routing/turns';

const loadDotEnvIfExists = (path = '.env') => {
  if (!existsSync(path)) return;

  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const match = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(trimmed);
    if (!match) continue;

    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (process.env[match[1]] === undefined) {
      process.env[match[1]] = value;
    }
  }
};

const formatClientError = error => {
  if (error instanceof RoutingApiError) {
    return `Routing API rejected the request with HTTP ${error.status}: ${error.message}`;
  }
  if (error instanceof RoutingInvalidResponseError) {
    return `Routing API returned an unexpected response: ${error.message}`;
  }
  if (error instanceof Error) return error.message;
  return 'The chat example could not complete the request.';
};

class RoutingChatCli {
  constructor(rl, config) {
    this.rl = rl;
    this.config = config;
    this.history = [];
    this.sessionToken = null;
  }

  async run() {
    this.printIntro();
    const client = createRoutingApiClient({
      baseUrl: this.config.baseUrl,
      headers: this.config.debugManagedInterpretation
        ? { 'x-routing-debug': 'managed-interpretation' }
        : undefined
    });
    const startRequest = buildStartSessionInput(this.config);

    let response;
    try {
      response = await client.startSession(startRequest);
    } catch (error) {
      console.error(formatClientError(error));
      process.exitCode = 1;
      return;
    }

    this.record('Start session', startRequest, response);
    this.renderResponse(response);

    while (response.nextAction.type === 'ask') {
      const action = response.nextAction;
      const request = await this.collectTurnRequest(action);
      if (!request) return;

      try {
        response = await client.advanceSession(request);
      } catch (error) {
        console.error(formatClientError(error));
        console.log('The session is still on the same question. Try again.');
        continue;
      }

      this.record('Send turn', request, response);
      this.renderResponse(response);
    }
  }

  printIntro() {
    console.log('');
    console.log('Routing API chat example');
    console.log(`API: ${this.config.baseUrl}`);
    console.log(
      `Mode: ${this.config.interpreterMode}; target: ${targetSystemLabel(
        this.config.targetSystem
      )}`
    );
    console.log('Type :help during a turn for commands.');
    console.log('');
  }

  record(label, request, response) {
    this.sessionToken = response.sessionToken;
    this.history.push(
      historyEntry({
        label,
        path: pathForHistoryLabel(label),
        request,
        response
      })
    );
  }

  renderResponse(response) {
    const action = response.nextAction;
    console.log('');
    console.log(`Assistant action: ${action.type}`);

    if (action.type === 'ask') {
      this.renderAskAction(action);
    } else if (action.type === 'say') {
      console.log(action.message);
    } else if (action.type === 'resolved') {
      this.renderTargets(action.targets);
      if (action.screening) {
        console.log('');
        console.log('Screening outcome');
        console.log(`Priority: ${action.screening.priorityId}`);
        console.log(`Outcome: ${action.screening.outcomeText}`);
        if (action.screening.screeningNote?.trim()) {
          console.log('Screening note:');
          console.log(action.screening.screeningNote);
        }
      }
    } else if (action.type === 'handoff') {
      console.log(`Urgency: ${action.urgency}`);
      console.log(action.message);
      if (action.targets) this.renderTargets(action.targets);
    } else {
      console.log(action.message);
      console.log(action.retryable ? 'Retryable: yes' : 'Retryable: no');
    }

    const selectedGuides = selectedGuideTargets(action);
    if (selectedGuides.length > 0) {
      console.log('');
      console.log('Selected SymptomScreen guides');
      for (const guide of selectedGuides) {
        console.log(`- ${guide.title} (#${guide.id})`);
      }
    }

    if (response.debug?.managedInterpretationDiagnostics?.length) {
      console.log('');
      console.log(
        `Debug diagnostics: ${response.debug.managedInterpretationDiagnostics.length} item(s). Type :debug to inspect.`
      );
    }
  }

  renderAskAction(action) {
    console.log(action.question.text);
    if (action.question.helperText) console.log(action.question.helperText);

    if (action.question.inputKind === 'single_select') {
      console.log('');
      console.log('Choices');
      action.question.options?.forEach((option, index) => {
        console.log(`${index + 1}. ${option.label} (${option.id})`);
      });
    }

    if (action.llmTask && this.config.interpreterMode === 'byo') {
      console.log('');
      console.log(
        `BYO model task: ${action.llmTask.schemaName} ${action.llmTask.schemaVersion}; submit as ${action.llmTask.resultField}.`
      );
    }
  }

  renderTargets(targets) {
    console.log('');
    console.log('Targets');
    for (const target of targets ?? []) {
      console.log(`- ${target.title} (${target.targetSystem}:${target.id})`);
    }
  }

  async collectTurnRequest(action) {
    if (!this.sessionToken) {
      throw new Error('Cannot continue without a session token.');
    }

    return this.config.interpreterMode === 'managed'
      ? await this.collectManagedTurn(action, this.sessionToken)
      : await this.collectByoTurn(action, this.sessionToken);
  }

  async collectManagedTurn(action, sessionToken) {
    while (true) {
      const hint =
        action.question.inputKind === 'single_select'
          ? 'Type caller text, an option number, or an option id'
          : 'Type the caller reply';
      const line = await this.askForValue(`${hint}> `, { action });
      if (line === null) return null;

      const direct = this.directCommandRequest(line, action, sessionToken);
      if (direct.commandHandled) {
        if (direct.request) return direct.request;
        continue;
      }

      if (action.question.inputKind === 'single_select') {
        const optionId = optionIdFromChoice(action.question, line);
        if (optionId) {
          const request = buildOptionAdvanceRequest({
            optionId,
            question: action.question,
            sessionToken
          });
          if (request) return request;
        }
      }

      const request = buildMessageAdvanceRequest({ sessionToken, text: line });
      if (request) return request;
      console.log('Enter caller text before sending this turn.');
    }
  }

  async collectByoTurn(action, sessionToken) {
    while (true) {
      const request = await this.collectByoDirectAnswer(action, sessionToken);
      if (request !== undefined) return request;

      if (!action.llmTask) {
        console.log('This BYO turn does not include a model task.');
        continue;
      }

      const callerText = await this.askForValue(
        'Patient or caregiver reply for your model> ',
        { action }
      );
      if (callerText === null) return null;

      const direct = this.directCommandRequest(callerText, action, sessionToken);
      if (direct.commandHandled) {
        if (direct.request) return direct.request;
        continue;
      }

      return await this.collectByoLlmResult(action, sessionToken, callerText);
    }
  }

  async collectByoDirectAnswer(action, sessionToken) {
    if (action.question.inputKind === 'single_select') {
      const value = await this.askForValue(
        'Choose an option, type :llm for the BYO model, or type caller text> ',
        { action }
      );
      if (value === null) return null;
      if (value.trim() === ':llm') return undefined;

      const direct = this.directCommandRequest(value, action, sessionToken);
      if (direct.commandHandled) return direct.request ?? undefined;

      const optionId = optionIdFromChoice(action.question, value);
      if (optionId) {
        return buildOptionAdvanceRequest({
          optionId,
          question: action.question,
          sessionToken
        });
      }

      if (action.llmTask) {
        return await this.collectByoLlmResult(action, sessionToken, value);
      }

      console.log('Choose a valid option before sending this turn.');
      return undefined;
    }

    if (action.question.inputKind === 'number') {
      const value = await this.askForValue(
        'Enter a number, type :llm for the BYO model, or type caller text> ',
        { action }
      );
      if (value === null) return null;
      if (value.trim() === ':llm') return undefined;

      const direct = this.directCommandRequest(value, action, sessionToken);
      if (direct.commandHandled) return direct.request ?? undefined;

      if (parseNumberAnswer(value) !== null) {
        return buildNumberAdvanceRequest({
          question: action.question,
          sessionToken,
          value
        });
      }

      if (action.llmTask) {
        return await this.collectByoLlmResult(action, sessionToken, value);
      }

      console.log('Enter a valid number before sending this turn.');
      return undefined;
    }

    if (action.question.inputKind === 'date') {
      const value = await this.askForValue(
        'Enter a date, type :llm for the BYO model, or type caller text> ',
        { action }
      );
      if (value === null) return null;
      if (value.trim() === ':llm') return undefined;

      const direct = this.directCommandRequest(value, action, sessionToken);
      if (direct.commandHandled) return direct.request ?? undefined;

      if (parseDateAnswer(value)) {
        return buildDateAdvanceRequest({
          question: action.question,
          sessionToken,
          value
        });
      }

      if (action.llmTask) {
        return await this.collectByoLlmResult(action, sessionToken, value);
      }

      console.log('Enter a date in YYYY-MM-DD format before sending this turn.');
      return undefined;
    }

    return undefined;
  }

  async collectByoLlmResult(action, sessionToken, callerText) {
    if (!action.llmTask) {
      console.log('No BYO model task is available for this question.');
      return null;
    }

    console.log('');
    console.log('Run this prompt in your own model workflow:');
    console.log('');
    console.log(
      buildCompleteByoPrompt({
        callerText,
        question: action.question,
        task: action.llmTask
      })
    );
    console.log('');

    while (true) {
      const resultJson = await this.askForJsonBlock({ action, callerText });
      if (resultJson === null) return null;

      try {
        return buildByoLlmAdvanceRequest({
          resultJson,
          sessionToken,
          task: action.llmTask
        });
      } catch {
        console.log('That was not valid JSON. Paste the model result again.');
      }
    }
  }

  directCommandRequest(line, action, sessionToken) {
    const trimmed = line.trim();
    if (!trimmed.startsWith(':')) return { commandHandled: false };

    const [command, ...rest] = trimmed.split(/\s+/);
    const value = rest.join(' ');

    if (command === ':option') {
      const optionId = optionIdFromChoice(action.question, value);
      const request = optionId
        ? buildOptionAdvanceRequest({
            optionId,
            question: action.question,
            sessionToken
          })
        : null;
      if (!request) console.log('That is not a valid option for this question.');
      return { commandHandled: true, ...(request ? { request } : {}) };
    }

    if (command === ':number') {
      const request = buildNumberAdvanceRequest({
        question: action.question,
        sessionToken,
        value
      });
      if (!request) console.log('Enter a valid number after :number.');
      return { commandHandled: true, ...(request ? { request } : {}) };
    }

    if (command === ':date') {
      const request = buildDateAdvanceRequest({
        question: action.question,
        sessionToken,
        value
      });
      if (!request) console.log('Enter a YYYY-MM-DD date after :date.');
      return { commandHandled: true, ...(request ? { request } : {}) };
    }

    if (command === ':unresolved') {
      return {
        commandHandled: true,
        request: buildUnresolvedAdvanceRequest({
          question: action.question,
          sessionToken
        })
      };
    }

    return { commandHandled: false };
  }

  async askForValue(prompt, context) {
    while (true) {
      const line = await this.rl.question(prompt);
      const commandResult = this.handleCommand(line, {
        ...context,
        baseUrl: this.config.baseUrl,
        debugManagedInterpretation: this.config.debugManagedInterpretation,
        history: this.history
      });
      if (commandResult === 'quit') return null;
      if (commandResult === 'handled') continue;
      return line;
    }
  }

  async askForJsonBlock(context) {
    console.log(
      `Paste ${context.action?.llmTask?.resultField ?? 'result'} JSON. End multi-line JSON with a single "." line.`
    );

    const lines = [];
    while (true) {
      const line = await this.rl.question(lines.length ? 'json... ' : 'json> ');
      if (!lines.length) {
        const commandResult = this.handleCommand(line, {
          ...context,
          baseUrl: this.config.baseUrl,
          debugManagedInterpretation: this.config.debugManagedInterpretation,
          history: this.history
        });
        if (commandResult === 'quit') return null;
        if (commandResult === 'handled') continue;

        try {
          parseJsonInput(line);
          return line;
        } catch {
          lines.push(line);
          continue;
        }
      }

      if (line.trim() === '.') return lines.join('\n');
      lines.push(line);
    }
  }

  handleCommand(line, context) {
    const trimmed = line.trim();
    if (!trimmed.startsWith(':')) return 'value';

    const [command] = trimmed.split(/\s+/);
    if (
      command === ':option' ||
      command === ':number' ||
      command === ':date' ||
      command === ':unresolved' ||
      command === ':llm'
    ) {
      return 'value';
    }

    if (command === ':quit') return 'quit';
    if (command === ':help') {
      console.log(turnHelpText);
      return 'handled';
    }
    if (command === ':history') {
      console.log(prettyJson(redactCredentials(context.history)));
      return 'handled';
    }

    const last = context.history[context.history.length - 1];
    if (!last) {
      console.log('No API calls have been made yet.');
      return 'handled';
    }

    if (command === ':request') {
      console.log(prettyJson(redactCredentials(last.request)));
      return 'handled';
    }
    if (command === ':response') {
      console.log(prettyJson(redactCredentials(last.response)));
      return 'handled';
    }
    if (command === ':curl') {
      console.log(
        buildCurl({
          baseUrl: context.baseUrl,
          body: last.request,
          debugManagedInterpretation: context.debugManagedInterpretation,
          path: last.path
        })
      );
      return 'handled';
    }
    if (command === ':debug') {
      console.log(
        prettyJson(last.response?.debug?.managedInterpretationDiagnostics ?? [])
      );
      return 'handled';
    }
    if (command === ':prompt') {
      if (!context.action?.llmTask) {
        console.log('No BYO model task is active.');
      } else {
        console.log(
          buildCompleteByoPrompt({
            callerText: context.callerText ?? '',
            question: context.action.question,
            task: context.action.llmTask
          })
        );
      }
      return 'handled';
    }
    if (command === ':schema') {
      if (!context.action?.llmTask) {
        console.log('No BYO response schema is active.');
      } else {
        console.log(prettyJson(context.action.llmTask.responseSchema));
      }
      return 'handled';
    }

    console.log(`Unknown command: ${command}. Type :help for options.`);
    return 'handled';
  }
}

const selectValue = async ({ defaultValue, label, options, rl }) => {
  console.log(label);
  options.forEach((option, index) => {
    const suffix = option.value === defaultValue ? ' default' : '';
    console.log(`${index + 1}. ${option.label}${suffix}`);
  });

  while (true) {
    const answer = (await rl.question('Choose a number> ')).trim();
    if (!answer) return defaultValue;

    const choice = Number(answer);
    const selected =
      Number.isInteger(choice) && choice > 0 && choice <= options.length
        ? options[choice - 1]
        : options.find(option => option.value === answer);
    if (selected) return selected.value;
    console.log('Choose one of the listed options.');
  }
};

const askOptional = async ({ defaultValue, label, rl }) => {
  const suffix = defaultValue ? ` [${defaultValue}]` : '';
  const answer = (await rl.question(`${label}${suffix}> `)).trim();
  return answer || defaultValue || undefined;
};

const askRequired = async ({ defaultValue, label, rl }) => {
  while (true) {
    const value = await askOptional({ defaultValue, label, rl });
    if (value?.trim()) return value.trim();
    console.log('This value is required.');
  }
};

const askDateOfBirth = async ({ defaultValue, rl }) => {
  while (true) {
    const value = await askOptional({
      defaultValue,
      label: 'Known date of birth, optional',
      rl
    });
    if (!value) return undefined;

    const normalized = normalizeDateInput(value);
    if (normalized) return normalized;
    console.log('Use YYYY-MM-DD or MM/DD/YYYY, and do not use a future date.');
  }
};

const collectConfig = async (flags, rl, suppliedFields) => {
  const baseUrl =
    suppliedFields.has('baseUrl') && flags.baseUrl?.trim()
      ? flags.baseUrl.trim()
      : await askRequired({
          defaultValue: flags.baseUrl?.trim() || DEFAULT_ROUTING_API_BASE_URL,
          label: 'Routing API base URL',
          rl
        });
  const organizationKey =
    suppliedFields.has('organizationKey') && flags.organizationKey?.trim()
      ? flags.organizationKey.trim()
      : await askRequired({
          defaultValue: flags.organizationKey,
          label: 'Routing API key',
          rl
        });
  const targetSystem =
    suppliedFields.has('targetSystem') && flags.targetSystem
      ? flags.targetSystem
      : await selectValue({
          defaultValue: flags.targetSystem ?? 'symptomscreen',
          label: 'Target system',
          options: [
            { label: 'SymptomScreen', value: 'symptomscreen' },
            { label: 'ClearTriage', value: 'cleartriage' }
          ],
          rl
        });
  const interpreterMode =
    suppliedFields.has('interpreterMode') && flags.interpreterMode
      ? flags.interpreterMode
      : await selectValue({
          defaultValue: flags.interpreterMode ?? 'managed',
          label: 'Interpreter mode',
          options: [
            {
              label: 'Managed: send caller text to the Routing API',
              value: 'managed'
            },
            {
              label: 'BYO: keep caller text local and submit model JSON',
              value: 'byo'
            }
          ],
          rl
        });

  const dateOfBirth =
    (suppliedFields.has('dateOfBirth')
      ? normalizeDateInput(flags.dateOfBirth ?? '')
      : await askDateOfBirth({ defaultValue: flags.dateOfBirth, rl })) ??
    undefined;
  if (suppliedFields.has('dateOfBirth') && !dateOfBirth) {
    throw new Error(
      'Date of birth must be YYYY-MM-DD or MM/DD/YYYY, and cannot be in the future.'
    );
  }

  const sexAssignedAtBirth =
    suppliedFields.has('sexAssignedAtBirth') && flags.sexAssignedAtBirth
      ? flags.sexAssignedAtBirth
      : await selectValue({
          defaultValue: flags.sexAssignedAtBirth ?? '',
          label: 'Known sex assigned at birth',
          options: [
            { label: 'Ask later', value: '' },
            { label: 'Female', value: 'female' },
            { label: 'Male', value: 'male' },
            { label: 'Unknown', value: 'unknown' }
          ],
          rl
        });
  const relationshipToPatient =
    suppliedFields.has('relationshipToPatient') && flags.relationshipToPatient
      ? flags.relationshipToPatient
      : await selectValue({
          defaultValue: flags.relationshipToPatient ?? '',
          label: 'Known relationship to patient',
          options: [
            { label: 'Ask later', value: '' },
            { label: 'Self', value: 'self' },
            { label: 'Parent', value: 'parent' },
            { label: 'Guardian', value: 'guardian' },
            { label: 'Spouse or partner', value: 'spouse_or_partner' },
            { label: 'Family member', value: 'family_member' },
            { label: 'Caregiver', value: 'caregiver' },
            { label: 'Clinician', value: 'clinician' },
            { label: 'Other', value: 'other' },
            { label: 'Unknown', value: 'unknown' }
          ],
          rl
        });

  const knownFacts = knownFactsFromValues({
    dateOfBirth,
    relationshipToPatient: relationshipToPatient || undefined,
    sexAssignedAtBirth: sexAssignedAtBirth || undefined
  });
  const managedInitialText =
    interpreterMode === 'managed'
      ? suppliedFields.has('managedInitialText')
        ? flags.managedInitialText
        : await askOptional({
            defaultValue: flags.managedInitialText,
            label: 'Initial caller message, optional',
            rl
          })
      : undefined;

  return {
    baseUrl,
    debugManagedInterpretation:
      flags.debugManagedInterpretation === undefined
        ? true
        : flags.debugManagedInterpretation,
    interpreterMode,
    knownFacts,
    managedInitialText,
    organizationKey,
    targetSystem
  };
};

const main = async () => {
  let flags;
  let envDefaults;
  let cliFlags;
  try {
    envDefaults = routingChatDefaultsFromEnv(process.env);
    cliFlags = parseRoutingChatCliArgs(process.argv.slice(2));
    flags = mergeFlags(envDefaults, cliFlags);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    console.log(helpText);
    process.exitCode = 1;
    return;
  }

  if (flags.help) {
    console.log(helpText);
    return;
  }

  const rl = createInterface({ input, output });
  try {
    const config = await collectConfig(
      flags,
      rl,
      suppliedSetupFields(envDefaults, cliFlags)
    );
    await new RoutingChatCli(rl, config).run();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  } finally {
    rl.close();
  }
};

loadDotEnvIfExists();

void main();
