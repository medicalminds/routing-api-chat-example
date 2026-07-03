import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DecisionTreeTraversalError,
  createDecisionTreeCursor,
  decisionTreeBranchForAnswer,
  deserializeDecisionTree
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

test('deserializes a public SymptomScreen decision tree', () => {
  const root = deserializeDecisionTree(decisionTree);

  assert.equal(root.value.type, 'question');
  assert.equal(root.left.value.outcome.name, 'Go now');
  assert.equal(root.right.value.outcome.name, 'Home care');
});

test('treats only a clean no as the no branch', () => {
  assert.equal(decisionTreeBranchForAnswer('no'), 'right');

  for (const answer of ['yes', 'maybe', 'unsure', 'unclear']) {
    assert.equal(decisionTreeBranchForAnswer(answer), 'left');
  }

  assert.throws(
    () => decisionTreeBranchForAnswer('unknown'),
    DecisionTreeTraversalError
  );
});

test('walks a decision tree with a cursor', () => {
  const cursor = createDecisionTreeCursor(decisionTree);

  assert.equal(cursor.current().type, 'question');
  assert.equal(cursor.answer('unclear').outcome.name, 'Go now');
  assert.equal(cursor.isComplete(), true);
  assert.deepEqual(
    cursor.path().map((step) => ({
      answer: step.answer,
      branch: step.branch,
      nextType: step.next.type
    })),
    [
      {
        answer: 'unclear',
        branch: 'left',
        nextType: 'outcome'
      }
    ]
  );

  cursor.reset();
  assert.equal(cursor.answer('no').outcome.name, 'Home care');
});

test('rejects malformed serialized trees', () => {
  assert.throws(
    () =>
      deserializeDecisionTree({
        ...decisionTree,
        nodes: [decisionTree.nodes[0]]
      }),
    DecisionTreeTraversalError
  );
  assert.throws(
    () => deserializeDecisionTree({ ...decisionTree, nodes: [null] }),
    /Decision tree root is empty/
  );
  assert.throws(
    () =>
      deserializeDecisionTree({
        ...decisionTree,
        nodes: [{ type: 'unsupported' }, null, null]
      }),
    /unsupported node value/
  );
});
