import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DecisionTreeTraversalError,
  isDecisionTreeAnswer,
  loadDecisionTree
} from '../src/decision-tree.js';

const decisionTree = {
  schemaVersion: 'symptomscreen-decision-tree.v1',
  targetSystem: 'symptomscreen',
  targets: [
    {
      targetSystem: 'symptomscreen',
      id: 95,
      title: 'Rash or Redness - Widespread'
    }
  ],
  nodes: [
    {
      type: 'question',
      source: 'main_screening',
      questions: [
        {
          id: 501,
          text: 'Do they have trouble breathing?'
        }
      ]
    },
    {
      type: 'outcome',
      outcome: {
        id: 1,
        acuity: 1,
        name: 'Go now',
        text: 'Go now'
      }
    },
    null,
    null,
    {
      type: 'outcome',
      outcome: {
        id: 7,
        acuity: 7,
        name: 'Home care',
        text: 'Home care'
      }
    },
    null,
    null
  ]
};

const groupedQuestionDecisionTree = {
  ...decisionTree,
  nodes: [
    {
      type: 'question',
      source: 'main_screening',
      questions: [
        {
          id: 501,
          text: 'Do they have trouble breathing?'
        },
        {
          id: 502,
          text: 'Do they have facial swelling?'
        }
      ]
    },
    {
      type: 'outcome',
      outcome: {
        id: 1,
        acuity: 1,
        name: 'Go now',
        text: 'Go now'
      }
    },
    null,
    null,
    {
      type: 'outcome',
      outcome: {
        id: 7,
        acuity: 7,
        name: 'Home care',
        text: 'Home care'
      }
    },
    null,
    null
  ]
};

const reversePolarityDecisionTree = {
  ...decisionTree,
  nodes: [
    {
      type: 'question',
      source: 'main_screening',
      questions: [
        {
          id: 501,
          text: 'Can they breathe comfortably?',
          answers: {
            yes: 'left',
            no: 'right',
            unsure: 'right'
          }
        }
      ]
    },
    {
      type: 'outcome',
      outcome: {
        id: 7,
        acuity: 7,
        name: 'Home care',
        text: 'Home care'
      }
    },
    null,
    null,
    {
      type: 'outcome',
      outcome: {
        id: 1,
        acuity: 1,
        name: 'Go now',
        text: 'Go now'
      }
    },
    null,
    null
  ]
};

const mixedPolarityMultipartDecisionTree = {
  ...decisionTree,
  nodes: [
    {
      type: 'question',
      source: 'main_screening',
      questions: [
        {
          id: 70,
          text: 'Are they bleeding?',
          answers: {
            yes: 'left',
            no: 'right',
            unsure: 'left'
          }
        }
      ]
    },
    {
      type: 'question',
      source: 'main_screening',
      questions: [
        {
          id: 70,
          text: 'Can the bleeding be stopped?',
          answers: {
            yes: 'left',
            no: 'right',
            unsure: 'right'
          }
        }
      ]
    },
    {
      type: 'outcome',
      outcome: {
        id: 7,
        acuity: 7,
        name: 'Home care',
        text: 'Home care'
      }
    },
    null,
    null,
    {
      type: 'outcome',
      outcome: {
        id: 1,
        acuity: 1,
        name: 'Go now',
        text: 'Go now'
      }
    },
    null,
    null,
    {
      type: 'outcome',
      outcome: {
        id: 7,
        acuity: 7,
        name: 'Home care',
        text: 'Home care'
      }
    },
    null,
    null
  ]
};

const nestedInitialCursorDecisionTree = {
  ...decisionTree,
  initialCursor: {
    nodePath: ['right'],
    questionIndex: 0,
    questionId: 601
  },
  nodes: [
    {
      type: 'question',
      source: 'main_screening',
      questions: [
        {
          id: 501,
          text: 'Auto-answered root question'
        }
      ]
    },
    {
      type: 'outcome',
      outcome: {
        id: 1,
        acuity: 1,
        name: 'Go now',
        text: 'Go now'
      }
    },
    null,
    null,
    {
      type: 'question',
      source: 'main_screening',
      questions: [
        {
          id: 601,
          text: 'Nested current question'
        }
      ]
    },
    {
      type: 'outcome',
      outcome: {
        id: 2,
        acuity: 2,
        name: 'Call now',
        text: 'Call now'
      }
    },
    null,
    null,
    {
      type: 'outcome',
      outcome: {
        id: 7,
        acuity: 7,
        name: 'Home care',
        text: 'Home care'
      }
    },
    null,
    null
  ]
};

test('loads a public SymptomScreen decision tree and returns the current question', () => {
  const helper = loadDecisionTree(decisionTree);

  assert.deepEqual(helper.current(), {
    type: 'question',
    question: {
      id: 501,
      text: 'Do they have trouble breathing?'
    },
    targets: decisionTree.targets
  });
  assert.equal(helper.isComplete(), false);
});

test('accepts the same answer values used by /routing/turns screeningAnswer', () => {
  assert.equal(isDecisionTreeAnswer('no'), true);
  assert.equal(isDecisionTreeAnswer(' No '), true);
  assert.equal(isDecisionTreeAnswer('Unsure'), true);
  assert.equal(isDecisionTreeAnswer('unknown'), false);

  const helper = loadDecisionTree(decisionTree);
  assert.equal(helper.answer(' Unclear ').outcome.name, 'Go now');

  assert.throws(
    () => loadDecisionTree(decisionTree).answer('unknown'),
    DecisionTreeTraversalError
  );
});

test('walks to the outcome for safety-positive and clean-no answers', () => {
  const helper = loadDecisionTree(decisionTree);

  assert.equal(helper.answer('unclear').outcome.name, 'Go now');
  assert.equal(helper.isComplete(), true);
  assert.deepEqual(helper.history(), [
    {
      question: {
        id: 501,
        text: 'Do they have trouble breathing?'
      },
      answer: 'unclear'
    }
  ]);

  helper.reset();
  assert.equal(helper.answer('no').outcome.name, 'Home care');
});

test('treats missing branches as completed empty traversal', () => {
  const helper = loadDecisionTree({
    ...decisionTree,
    nodes: [
      decisionTree.nodes[0],
      null,
      decisionTree.nodes[4],
      null,
      null
    ]
  });

  assert.equal(helper.answer('yes'), null);
  assert.equal(helper.current(), null);
  assert.equal(helper.isComplete(), true);
});

test('returns values without exposing mutable traversal state', () => {
  const helper = loadDecisionTree(decisionTree);
  const current = helper.current();
  current.question.text = 'Changed by a caller UI';
  current.targets[0].title = 'Changed guide title';

  assert.equal(
    helper.current().question.text,
    'Do they have trouble breathing?'
  );
  assert.equal(
    helper.current().targets[0].title,
    'Rash or Redness - Widespread'
  );

  const outcome = helper.answer('yes');
  outcome.outcome.text = 'Changed by a caller UI';

  assert.equal(helper.current().outcome.text, 'Go now');
});

test('walks grouped questions one flat question at a time', () => {
  const helper = loadDecisionTree(groupedQuestionDecisionTree);

  assert.equal(helper.current().question.id, 501);
  assert.equal(helper.answer('no').question.id, 502);
  assert.equal(helper.isComplete(), false);
  assert.equal(helper.answer('no').outcome.name, 'Home care');
  assert.deepEqual(
    helper.history().map((step) => ({
      questionId: step.question.id,
      answer: step.answer
    })),
    [
      {
        questionId: 501,
        answer: 'no'
      },
      {
        questionId: 502,
        answer: 'no'
      }
    ]
  );

  helper.reset();
  assert.equal(helper.answer('unsure').outcome.name, 'Go now');
  helper.reset();
  assert.equal(helper.answer(' Unclear ').outcome.name, 'Go now');

  helper.reset();
  assert.equal(helper.answer('no').question.id, 502);
  assert.equal(helper.answer('yes').outcome.name, 'Go now');
  assert.deepEqual(
    helper.history().map((step) => ({
      questionId: step.question.id,
      answer: step.answer
    })),
    [
      {
        questionId: 501,
        answer: 'no'
      },
      {
        questionId: 502,
        answer: 'yes'
      }
    ]
  );
});

test('uses public answer maps for reverse-polarity uncertainty', () => {
  const helper = loadDecisionTree(reversePolarityDecisionTree);

  assert.equal(helper.current().question.text, 'Can they breathe comfortably?');
  assert.equal(helper.answer('unclear').outcome.name, 'Go now');

  helper.reset();
  assert.equal(helper.answer('maybe').outcome.name, 'Go now');

  helper.reset();
  assert.equal(helper.answer('yes').outcome.name, 'Home care');
});

test('uses public answer maps for mixed-polarity multipart prompts', () => {
  const helper = loadDecisionTree(mixedPolarityMultipartDecisionTree);

  assert.equal(helper.current().question.text, 'Are they bleeding?');
  assert.equal(
    helper.answer('unsure').question.text,
    'Can the bleeding be stopped?'
  );
  assert.equal(helper.answer('unsure').outcome.name, 'Go now');

  helper.reset();
  assert.equal(helper.answer('no').outcome.name, 'Home care');
});

test('starts from the server-provided initial cursor when present', () => {
  const helper = loadDecisionTree({
    ...groupedQuestionDecisionTree,
    initialCursor: {
      nodePath: [],
      questionIndex: 1,
      questionId: 502
    }
  });

  assert.equal(helper.current().question.id, 502);
  assert.equal(helper.answer('yes').outcome.name, 'Go now');

  assert.equal(helper.reset().question.id, 502);
  assert.equal(helper.answer('no').outcome.name, 'Home care');
});

test('starts from a nested server-provided initial cursor', () => {
  const helper = loadDecisionTree(nestedInitialCursorDecisionTree);

  assert.equal(helper.current().question.id, 601);
  assert.equal(helper.answer('yes').outcome.name, 'Call now');

  assert.equal(helper.reset().question.id, 601);
  assert.equal(helper.answer('no').outcome.name, 'Home care');
});

test('starts from the server-provided initial outcome when present', () => {
  const helper = loadDecisionTree({
    ...decisionTree,
    initialOutcome: {
      nodePath: ['right'],
      outcomeId: 7
    }
  });

  assert.equal(helper.current().outcome.name, 'Home care');
  assert.equal(helper.isComplete(), true);
  assert.equal(helper.answer('yes').outcome.name, 'Home care');
  assert.equal(helper.reset().outcome.name, 'Home care');
});

test('rejects invalid initial cursors', () => {
  assert.throws(
    () =>
      loadDecisionTree({
        ...groupedQuestionDecisionTree,
        initialCursor: {
          nodePath: 'left',
          questionIndex: 0,
          questionId: 501
        }
      }),
    /initial cursor is malformed/
  );

  assert.throws(
    () =>
      loadDecisionTree({
        ...groupedQuestionDecisionTree,
        initialCursor: {
          nodePath: ['left'],
          questionIndex: 0,
          questionId: 501
        }
      }),
    /initial cursor does not point to a question node/
  );

  assert.throws(
    () =>
      loadDecisionTree({
        ...groupedQuestionDecisionTree,
        initialCursor: {
          nodePath: [],
          questionIndex: 1,
          questionId: 501
        }
      }),
    /initial cursor does not match a question/
  );
});

test('rejects invalid initial outcomes', () => {
  assert.throws(
    () =>
      loadDecisionTree({
        ...decisionTree,
        initialOutcome: {
          nodePath: 'right',
          outcomeId: 7
        }
      }),
    /initial outcome is malformed/
  );

  assert.throws(
    () =>
      loadDecisionTree({
        ...decisionTree,
        initialOutcome: {
          nodePath: [],
          outcomeId: 7
        }
      }),
    /initial outcome does not point to an outcome node/
  );

  assert.throws(
    () =>
      loadDecisionTree({
        ...decisionTree,
        initialOutcome: {
          nodePath: ['right'],
          outcomeId: 1
        }
      }),
    /initial outcome does not match an outcome/
  );

  assert.throws(
    () =>
      loadDecisionTree({
        ...decisionTree,
        initialCursor: {
          nodePath: [],
          questionIndex: 0,
          questionId: 501
        },
        initialOutcome: {
          nodePath: ['right'],
          outcomeId: 7
        }
      }),
    /cannot include both initialCursor and initialOutcome/
  );
});

test('rejects malformed serialized trees', () => {
  assert.throws(
    () =>
      loadDecisionTree({
        ...decisionTree,
        schemaVersion: 'not-supported'
      }),
    /unsupported schemaVersion/
  );
  assert.throws(
    () =>
      loadDecisionTree({
        ...decisionTree,
        targetSystem: 'cleartriage'
      }),
    /must target SymptomScreen/
  );
  assert.throws(
    () =>
      loadDecisionTree({
        ...decisionTree,
        nodes: [decisionTree.nodes[0]]
      }),
    DecisionTreeTraversalError
  );
  assert.throws(
    () => loadDecisionTree({ ...decisionTree, nodes: [null] }),
    /Decision tree root is empty/
  );
  assert.throws(
    () =>
      loadDecisionTree({
        ...decisionTree,
        nodes: [{ type: 'unsupported' }, null, null]
      }),
    /unsupported node value/
  );
  assert.throws(
    () =>
      loadDecisionTree({
        ...decisionTree,
        nodes: [{ type: 'question', questions: [] }, null, null]
      }),
    /at least one valid question/
  );
  assert.throws(
    () =>
      loadDecisionTree({
        ...decisionTree,
        nodes: [
          { type: 'question', questions: [{ id: 501, text: '' }] },
          null,
          null
        ]
      }),
    /at least one valid question/
  );
});
