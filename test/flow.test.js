import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildByoLlmAdvanceRequest,
  buildCompleteByoPrompt,
  buildDateAdvanceRequest,
  buildMessageAdvanceRequest,
  buildNumberAdvanceRequest,
  buildOptionAdvanceRequest,
  buildStartSessionInput,
  buildUnresolvedAdvanceRequest,
  knownFactsFromValues,
  optionIdFromChoice,
  parseRoutingChatCliArgs,
  redactCredentials,
  routingChatDefaultsFromEnv
} from '../src/flow.js';

const routeQuestion = {
  id: 'question.medication_related',
  text: 'Did this start after taking medicine?',
  inputKind: 'single_select',
  options: [
    { id: 'med_yes', label: 'Yes' },
    { id: 'med_no', label: 'No' }
  ]
};

const screeningQuestion = {
  id: 501,
  text: 'Any trouble breathing?',
  inputKind: 'single_select',
  options: [
    { id: 'yes', label: 'Yes' },
    { id: 'no', label: 'No' }
  ]
};

const freeTextQuestion = {
  id: 'initial_concern',
  text: 'Can you tell me what is going on?',
  inputKind: 'free_text'
};

const llmTask = (resultField) => ({
  taskId: `task.${resultField}`,
  schemaName: 'routing_initial_interpretation',
  schemaVersion: 'routing-interpretation.v3',
  resultField,
  systemPrompt: 'Return JSON only.',
  userPromptTemplate:
    'Question: {{question.text}}\n\nCaller text:\n{{callerText}}',
  responseSchema: {
    type: 'object',
    additionalProperties: false
  }
});

test('builds managed and BYO start requests', () => {
  assert.deepEqual(
    buildStartSessionInput({
      organizationKey: ' org-key ',
      targetSystem: 'symptomscreen',
      interpreterMode: 'managed',
      knownFacts: {
        dateOfBirth: '2020-04-24',
        sexAssignedAtBirth: 'male',
        relationshipToPatient: 'parent'
      },
      managedInitialText: ' My child has a rash. '
    }),
    {
      organizationKey: 'org-key',
      targetSystem: 'symptomscreen',
      interpreterMode: 'managed',
      knownFacts: {
        dateOfBirth: '2020-04-24',
        sexAssignedAtBirth: 'male',
        relationshipToPatient: 'parent'
      },
      message: {
        text: 'My child has a rash.'
      }
    }
  );

  assert.deepEqual(
    buildStartSessionInput({
      organizationKey: 'org-key',
      targetSystem: 'symptomscreen',
      interpreterMode: 'byo',
      includeDecisionTree: true,
      managedInitialText: 'BYO should not send this text.'
    }),
    {
      organizationKey: 'org-key',
      targetSystem: 'symptomscreen',
      interpreterMode: 'byo',
      responseOptions: {
        includeDecisionTree: true
      }
    }
  );

  assert.deepEqual(
    buildStartSessionInput({
      organizationKey: 'org-key',
      targetSystem: 'symptomscreen',
      interpreterMode: 'byo',
      includeDecisionTree: true,
      decisionTreeMode: 'fetch'
    }),
    {
      organizationKey: 'org-key',
      targetSystem: 'symptomscreen',
      interpreterMode: 'byo'
    }
  );
});

test('normalizes setup facts from friendly input values', () => {
  assert.deepEqual(
    knownFactsFromValues({
      dateOfBirth: '4/24/2020',
      sexAssignedAtBirth: 'MALE',
      relationshipToPatient: 'Parent'
    }),
    {
      dateOfBirth: '2020-04-24',
      sexAssignedAtBirth: 'male',
      relationshipToPatient: 'parent'
    }
  );
});

test('renders the BYO prompt with caller text kept outside the Routing API', () => {
  const prompt = buildCompleteByoPrompt({
    callerText: 'My child has a rash on his chest.',
    question: freeTextQuestion,
    task: llmTask('interpretation')
  });
  assert.match(prompt, /Caller text:\nMy child has a rash on his chest\./);
  assert.match(prompt, /Submit the returned JSON as interpretation\./);
});

test('submits BYO model JSON under llmTask.resultField', () => {
  assert.deepEqual(
    buildByoLlmAdvanceRequest({
      sessionToken: 'token',
      task: llmTask('structuredAnswer'),
      resultJson: '{"type":"option","questionId":"q1","optionId":"yes"}'
    }),
    {
      sessionToken: 'token',
      structuredAnswer: {
        type: 'option',
        questionId: 'q1',
        optionId: 'yes'
      }
    }
  );

  assert.deepEqual(
    buildByoLlmAdvanceRequest({
      sessionToken: 'token',
      task: llmTask('screeningAnswer'),
      resultJson: '{"questionId":501,"answer":"no"}'
    }),
    {
      sessionToken: 'token',
      screeningAnswer: {
        questionId: 501,
        answer: 'no'
      }
    }
  );

  assert.deepEqual(
    buildByoLlmAdvanceRequest({
      sessionToken: 'token',
      task: llmTask('interpretation'),
      resultJson:
        '{"schemaVersion":"routing-interpretation.v3","concerns":[],"notes":[]}'
    }),
    {
      sessionToken: 'token',
      interpretation: {
        schemaVersion: 'routing-interpretation.v3',
        concerns: [],
        notes: []
      }
    }
  );

  assert.throws(
    () =>
      buildByoLlmAdvanceRequest({
        sessionToken: 'token',
        task: llmTask('unsupportedField'),
        resultJson: '{}'
      }),
    /Unsupported Routing API llmTask resultField/
  );
});

test('turns direct answers into advance requests', () => {
  assert.equal(optionIdFromChoice(routeQuestion, '2'), 'med_no');
  assert.deepEqual(
    buildOptionAdvanceRequest({
      sessionToken: 'token',
      question: routeQuestion,
      optionId: 'med_no'
    }),
    {
      sessionToken: 'token',
      structuredAnswer: {
        type: 'option',
        questionId: 'question.medication_related',
        optionId: 'med_no'
      }
    }
  );

  assert.deepEqual(
    buildOptionAdvanceRequest({
      sessionToken: 'token',
      question: screeningQuestion,
      optionId: 'maybe'
    }),
    {
      sessionToken: 'token',
      screeningAnswer: {
        questionId: 501,
        answer: 'maybe'
      }
    }
  );

  assert.deepEqual(
    buildNumberAdvanceRequest({
      sessionToken: 'token',
      question: {
        id: 'question.duration',
        text: 'How many?',
        inputKind: 'number'
      },
      value: '3'
    }),
    {
      sessionToken: 'token',
      structuredAnswer: {
        type: 'number',
        questionId: 'question.duration',
        value: 3
      }
    }
  );

  assert.deepEqual(
    buildDateAdvanceRequest({
      sessionToken: 'token',
      question: { id: 'question.started_on', text: 'When?', inputKind: 'date' },
      value: '2026-05-20'
    }),
    {
      sessionToken: 'token',
      structuredAnswer: {
        type: 'date',
        questionId: 'question.started_on',
        value: '2026-05-20'
      }
    }
  );

  assert.deepEqual(
    buildUnresolvedAdvanceRequest({
      sessionToken: 'token',
      question: routeQuestion
    }),
    {
      sessionToken: 'token',
      structuredAnswer: {
        type: 'unresolved',
        questionId: 'question.medication_related'
      }
    }
  );

  assert.deepEqual(
    buildMessageAdvanceRequest({ sessionToken: 'token', text: ' Hi ' }),
    {
      sessionToken: 'token',
      message: {
        text: 'Hi'
      }
    }
  );
});

test('parses flags and environment defaults for setup', () => {
  assert.deepEqual(
    parseRoutingChatCliArgs([
      '--api-key',
      'key',
      '--mode=byo',
      '--target-system',
      'symptomscreen',
      '--sex',
      'female',
      '--relationship',
      'self',
      '--decision-tree=fetch',
      '--no-debug'
    ]),
    {
      organizationKey: 'key',
      interpreterMode: 'byo',
      targetSystem: 'symptomscreen',
      sexAssignedAtBirth: 'female',
      relationshipToPatient: 'self',
      includeDecisionTree: true,
      decisionTreeMode: 'fetch',
      debugManagedInterpretation: false
    }
  );

  assert.deepEqual(parseRoutingChatCliArgs(['--decision-tree', 'inline']), {
    includeDecisionTree: true,
    decisionTreeMode: 'inline'
  });

  assert.deepEqual(parseRoutingChatCliArgs(['--no-decision-tree']), {
    includeDecisionTree: false,
    decisionTreeMode: null
  });

  assert.deepEqual(
    routingChatDefaultsFromEnv({
      ROUTING_API_BASE_URL: 'https://routing.example.com/api',
      ROUTING_API_KEY: 'env-key',
      ROUTING_INCLUDE_DECISION_TREE: 'fetch',
      ROUTING_INTERPRETER_MODE: 'MANAGED',
      ROUTING_TARGET_SYSTEM: 'cleartriage'
    }),
    {
      baseUrl: 'https://routing.example.com/api',
      organizationKey: 'env-key',
      interpreterMode: 'managed',
      targetSystem: 'cleartriage',
      dateOfBirth: undefined,
      sexAssignedAtBirth: undefined,
      relationshipToPatient: undefined,
      managedInitialText: undefined,
      includeDecisionTree: true,
      decisionTreeMode: 'fetch',
      debugManagedInterpretation: true
    }
  );
});

test('redacts credentials in history output', () => {
  assert.deepEqual(
    redactCredentials({
      organizationKey: 'secret',
      sessionToken: 'opaque',
      nested: { apiKey: 'secret-too', value: true }
    }),
    {
      organizationKey: '[redacted]',
      sessionToken: '[redacted]',
      nested: { apiKey: '[redacted]', value: true }
    }
  );
});
