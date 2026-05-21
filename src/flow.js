export const DEFAULT_ROUTING_API_BASE_URL = 'http://localhost:5555/api';

export const ROUTING_ENV = {
  apiKey: 'ROUTING_API_KEY',
  baseUrl: 'ROUTING_API_BASE_URL',
  dateOfBirth: 'ROUTING_DATE_OF_BIRTH',
  debugManagedInterpretation: 'ROUTING_DEBUG_MANAGED_INTERPRETATION',
  interpreterMode: 'ROUTING_INTERPRETER_MODE',
  managedInitialText: 'ROUTING_MANAGED_INITIAL_TEXT',
  organizationKey: 'ROUTING_ORGANIZATION_KEY',
  relationshipToPatient: 'ROUTING_RELATIONSHIP_TO_PATIENT',
  sexAssignedAtBirth: 'ROUTING_SEX_ASSIGNED_AT_BIRTH',
  targetSystem: 'ROUTING_TARGET_SYSTEM'
};

const targetSystems = ['symptomscreen', 'cleartriage'];
const interpreterModes = ['managed', 'byo'];
const sexAssignedAtBirthValues = ['female', 'male', 'unknown'];
const relationshipToPatientValues = [
  'self',
  'parent',
  'guardian',
  'spouse_or_partner',
  'family_member',
  'caregiver',
  'clinician',
  'other',
  'unknown'
];

const knownFlagNames = new Set([
  'api-base-url',
  'api-key',
  'base-url',
  'byo',
  'date-of-birth',
  'debug',
  'help',
  'managed',
  'managed-initial-text',
  'mode',
  'no-debug',
  'organization-key',
  'org-key',
  'relationship',
  'relationship-to-patient',
  'sex',
  'sex-assigned-at-birth',
  'target-system'
]);

export const prettyJson = value => JSON.stringify(value, null, 2);

export const stripJsonFence = value => {
  const trimmed = value.trim();
  const fenceMatch = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  return fenceMatch ? fenceMatch[1].trim() : trimmed;
};

export const parseJsonInput = value => JSON.parse(stripJsonFence(value));

const asString = value => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
};

const normalizedDateFromParts = (yearValue, monthValue, dayValue) => {
  const year = Number(yearValue);
  const month = Number(monthValue);
  const day = Number(dayValue);
  const date = new Date(Date.UTC(year, month - 1, day));

  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day) ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return `${year.toString().padStart(4, '0')}-${month
    .toString()
    .padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
};

export const todayIsoDate = () => new Date().toISOString().slice(0, 10);

export const normalizeDateInput = value => {
  const trimmed = value.trim().replace(/\s+/g, ' ');
  if (!trimmed) return null;

  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  const usMatch = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(trimmed);
  const dateOfBirth = isoMatch
    ? normalizedDateFromParts(isoMatch[1], isoMatch[2], isoMatch[3])
    : usMatch
      ? normalizedDateFromParts(usMatch[3], usMatch[1], usMatch[2])
      : null;

  if (!dateOfBirth || dateOfBirth > todayIsoDate()) return null;
  return dateOfBirth;
};

const normalizeOneOf = (value, allowed) => {
  const normalized = asString(value)?.toLowerCase();
  return normalized && allowed.includes(normalized) ? normalized : undefined;
};

export const normalizeTargetSystem = value =>
  normalizeOneOf(value, targetSystems);

export const normalizeInterpreterMode = value =>
  normalizeOneOf(value, interpreterModes);

export const normalizeSexAssignedAtBirth = value =>
  normalizeOneOf(value, sexAssignedAtBirthValues);

export const normalizeRelationshipToPatient = value =>
  normalizeOneOf(value, relationshipToPatientValues);

export const knownFactsFromValues = ({
  dateOfBirth,
  relationshipToPatient,
  sexAssignedAtBirth
}) => {
  const knownFacts = {};
  const normalizedDate = dateOfBirth ? normalizeDateInput(dateOfBirth) : undefined;
  const normalizedSex = normalizeSexAssignedAtBirth(sexAssignedAtBirth);
  const normalizedRelationship = normalizeRelationshipToPatient(
    relationshipToPatient
  );

  if (normalizedDate) knownFacts.dateOfBirth = normalizedDate;
  if (normalizedSex) knownFacts.sexAssignedAtBirth = normalizedSex;
  if (normalizedRelationship) {
    knownFacts.relationshipToPatient = normalizedRelationship;
  }

  return Object.keys(knownFacts).length > 0 ? knownFacts : undefined;
};

export const buildStartSessionInput = ({
  interpreterMode,
  knownFacts,
  managedInitialText,
  organizationKey,
  targetSystem
}) => {
  const base = {
    organizationKey: organizationKey.trim(),
    targetSystem,
    ...(knownFacts ? { knownFacts } : {})
  };

  if (interpreterMode === 'managed') {
    const text = managedInitialText?.trim();
    return {
      ...base,
      interpreterMode,
      ...(text ? { message: { text } } : {})
    };
  }

  return {
    ...base,
    interpreterMode
  };
};

export const renderByoUserPrompt = ({ callerText, question, task }) =>
  task.userPromptTemplate
    .split('{{question.text}}')
    .join(question.text)
    .split('{{callerText}}')
    .join(callerText.trim() || '[patient or caregiver reply]');

export const buildCompleteByoPrompt = ({ callerText, question, task }) =>
  [
    'System prompt:',
    task.systemPrompt,
    '',
    'User prompt:',
    renderByoUserPrompt({ callerText, question, task }),
    '',
    'Response schema:',
    prettyJson(task.responseSchema),
    '',
    `Submit the returned JSON as ${task.resultField}.`
  ].join('\n');

// The Routing API tells BYO callers which top-level field should receive
// the model's JSON result for the active turn.
export const buildByoLlmAdvanceRequest = ({ resultJson, sessionToken, task }) => {
  const parsed = parseJsonInput(resultJson);

  if (task.resultField === 'screeningAnswer') {
    return { sessionToken, screeningAnswer: parsed };
  }
  if (task.resultField === 'structuredAnswer') {
    return { sessionToken, structuredAnswer: parsed };
  }
  return { sessionToken, interpretation: parsed };
};

// SymptomScreen screening questions use numeric ids; routing questions use
// string ids and are submitted through the structured-answer shape.
export const isScreeningQuestion = question => typeof question.id === 'number';

export const isSymptomScreeningAnswerValue = value =>
  value === 'yes' || value === 'no' || value === 'unclear';

export const optionIdFromChoice = (question, value) => {
  const trimmed = value.trim();
  if (!trimmed || question.inputKind !== 'single_select') return null;

  const numberedChoice = Number(trimmed);
  if (
    Number.isInteger(numberedChoice) &&
    numberedChoice > 0 &&
    numberedChoice <= (question.options?.length ?? 0)
  ) {
    return question.options?.[numberedChoice - 1]?.id ?? null;
  }

  const normalized = trimmed.toLowerCase();
  return (
    question.options?.find(
      option =>
        option.id.toLowerCase() === normalized ||
        option.label.toLowerCase() === normalized
    )?.id ?? null
  );
};

export const buildOptionAdvanceRequest = ({ optionId, question, sessionToken }) => {
  if (
    question.inputKind !== 'single_select' ||
    !question.options?.some(option => option.id === optionId)
  ) {
    return null;
  }

  // Screening choices have a narrower API shape than route-question choices.
  if (isScreeningQuestion(question)) {
    if (!isSymptomScreeningAnswerValue(optionId)) return null;
    return {
      sessionToken,
      screeningAnswer: {
        questionId: question.id,
        answer: optionId
      }
    };
  }

  return {
    sessionToken,
    structuredAnswer: {
      type: 'option',
      questionId: String(question.id),
      optionId
    }
  };
};

export const parseNumberAnswer = value => {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
};

export const parseDateAnswer = value => {
  const trimmed = value.trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : null;
};

export const buildNumberAdvanceRequest = ({ question, sessionToken, value }) => {
  const parsed = parseNumberAnswer(value);
  if (parsed === null) return null;

  return {
    sessionToken,
    structuredAnswer: {
      type: 'number',
      questionId: String(question.id),
      value: parsed
    }
  };
};

export const buildDateAdvanceRequest = ({ question, sessionToken, value }) => {
  const parsed = parseDateAnswer(value);
  if (!parsed) return null;

  return {
    sessionToken,
    structuredAnswer: {
      type: 'date',
      questionId: String(question.id),
      value: parsed
    }
  };
};

export const buildUnresolvedAdvanceRequest = ({ question, sessionToken }) => ({
  sessionToken,
  structuredAnswer: {
    type: 'unresolved',
    questionId: String(question.id)
  }
});

export const buildMessageAdvanceRequest = ({ sessionToken, text }) => {
  const trimmed = text.trim();
  if (!trimmed) return null;
  return {
    sessionToken,
    message: { text: trimmed }
  };
};

export const readableId = value =>
  String(value)
    .replace(/^question\./, '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, character => character.toUpperCase());

export const targetSystemLabel = targetSystem =>
  targetSystem === 'symptomscreen' ? 'SymptomScreen' : 'ClearTriage';

const normalizedTargetId = target => {
  if (typeof target.id === 'number') return String(target.id);
  const numericId = Number(target.id);
  return Number.isInteger(numericId) && numericId > 0
    ? String(numericId)
    : target.id;
};

export const selectedGuideTargets = action => {
  if (!('targets' in action) || !Array.isArray(action.targets)) return [];

  const seen = new Set();
  return action.targets.filter(target => {
    if (target.targetSystem !== 'symptomscreen') return false;
    const key = `${target.targetSystem}:${normalizedTargetId(target)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

export const redactCredentials = value => {
  if (Array.isArray(value)) return value.map(item => redactCredentials(item));
  if (!value || typeof value !== 'object') return value;

  return Object.fromEntries(
    Object.entries(value).map(([key, fieldValue]) => [
      key,
      key === 'organizationKey' || key === 'sessionToken' || key === 'apiKey'
        ? '[redacted]'
        : redactCredentials(fieldValue)
    ])
  );
};

export const joinRoutingApiUrl = (baseUrl, path) => {
  const normalizedBase = baseUrl.trim().replace(/\/+$/, '');
  const normalizedPath = path.replace(/^\/+/, '');
  return normalizedBase
    ? `${normalizedBase}/${normalizedPath}`
    : `/${normalizedPath}`;
};

export const buildCurl = ({
  baseUrl,
  body,
  debugManagedInterpretation,
  path,
  redact = false
}) => {
  const headers = [
    '  -H "content-type: application/json"',
    ...(debugManagedInterpretation
      ? ['  -H "x-routing-debug: managed-interpretation"']
      : [])
  ];

  return [
    `curl -sS -X POST "${joinRoutingApiUrl(baseUrl, path)}" \\`,
    `${headers.join(' \\\n')} \\`,
    "  --data-binary @- <<'JSON'",
    prettyJson(redact ? redactCredentials(body) : body),
    'JSON'
  ].join('\n');
};

export const historyEntry = ({ label, path, request, response }) => ({
  label,
  path,
  request,
  response,
  timestamp: new Date().toISOString()
});

const booleanFlagValue = value => {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return true;
  return ['1', 'true', 'yes', 'y', 'on'].includes(normalized);
};

const readFlagValue = (args, index, rawValue) => {
  if (rawValue !== undefined) return { nextIndex: index, value: rawValue };

  const next = args[index + 1];
  if (!next || next.startsWith('--')) return { nextIndex: index, value: undefined };
  return { nextIndex: index + 1, value: next };
};

export const parseRoutingChatCliArgs = args => {
  const flags = {};

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith('--')) {
      throw new Error(`Unexpected positional argument: ${arg}`);
    }

    const equalsIndex = arg.indexOf('=');
    const rawName =
      equalsIndex === -1 ? arg.slice(2) : arg.slice(2, equalsIndex);
    const rawValue = equalsIndex === -1 ? undefined : arg.slice(equalsIndex + 1);
    if (!knownFlagNames.has(rawName)) throw new Error(`Unknown option: --${rawName}`);

    if (rawName === 'help') {
      flags.help = true;
      continue;
    }
    if (rawName === 'debug') {
      flags.debugManagedInterpretation = booleanFlagValue(rawValue);
      continue;
    }
    if (rawName === 'no-debug') {
      flags.debugManagedInterpretation = false;
      continue;
    }
    if (rawName === 'managed') {
      flags.interpreterMode = 'managed';
      continue;
    }
    if (rawName === 'byo') {
      flags.interpreterMode = 'byo';
      continue;
    }

    const { nextIndex, value } = readFlagValue(args, index, rawValue);
    index = nextIndex;
    if (value === undefined) throw new Error(`Missing value for --${rawName}`);

    switch (rawName) {
      case 'api-base-url':
      case 'base-url':
        flags.baseUrl = value;
        break;
      case 'api-key':
      case 'organization-key':
      case 'org-key':
        flags.organizationKey = value;
        break;
      case 'target-system':
        flags.targetSystem = normalizeTargetSystem(value);
        if (!flags.targetSystem) {
          throw new Error('--target-system must be "symptomscreen" or "cleartriage".');
        }
        break;
      case 'mode':
        flags.interpreterMode = normalizeInterpreterMode(value);
        if (!flags.interpreterMode) throw new Error('--mode must be "managed" or "byo".');
        break;
      case 'date-of-birth':
        flags.dateOfBirth = value;
        break;
      case 'sex':
      case 'sex-assigned-at-birth':
        flags.sexAssignedAtBirth = normalizeSexAssignedAtBirth(value);
        if (!flags.sexAssignedAtBirth) {
          throw new Error('--sex-assigned-at-birth must be "female", "male", or "unknown".');
        }
        break;
      case 'relationship':
      case 'relationship-to-patient':
        flags.relationshipToPatient = normalizeRelationshipToPatient(value);
        if (!flags.relationshipToPatient) {
          throw new Error('--relationship-to-patient is not a supported relationship value.');
        }
        break;
      case 'managed-initial-text':
        flags.managedInitialText = value;
        break;
    }
  }

  return flags;
};

export const routingChatDefaultsFromEnv = env => ({
  baseUrl: asString(env[ROUTING_ENV.baseUrl]),
  organizationKey:
    asString(env[ROUTING_ENV.apiKey]) ?? asString(env[ROUTING_ENV.organizationKey]),
  targetSystem: normalizeTargetSystem(env[ROUTING_ENV.targetSystem]),
  interpreterMode: normalizeInterpreterMode(env[ROUTING_ENV.interpreterMode]),
  dateOfBirth: asString(env[ROUTING_ENV.dateOfBirth]),
  sexAssignedAtBirth: normalizeSexAssignedAtBirth(
    env[ROUTING_ENV.sexAssignedAtBirth]
  ),
  relationshipToPatient: normalizeRelationshipToPatient(
    env[ROUTING_ENV.relationshipToPatient]
  ),
  managedInitialText: asString(env[ROUTING_ENV.managedInitialText]),
  debugManagedInterpretation: booleanFlagValue(
    env[ROUTING_ENV.debugManagedInterpretation]
  )
});
