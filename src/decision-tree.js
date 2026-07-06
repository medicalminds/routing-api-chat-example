const answerValues = new Set(['yes', 'no', 'maybe', 'unsure', 'unclear']);

/**
 * The same normalized answer vocabulary accepted by the Routing API
 * `screeningAnswer.answer` field on POST /routing/turns.
 *
 * @typedef {'yes' | 'no' | 'maybe' | 'unsure' | 'unclear'} DecisionTreeAnswer
 */

export class DecisionTreeTraversalError extends Error {
  constructor(message) {
    super(message);
    this.name = 'DecisionTreeTraversalError';
  }
}

const normalizeDecisionTreeAnswer = (value) => {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  return answerValues.has(normalized) ? normalized : null;
};

export const isDecisionTreeAnswer = (value) =>
  normalizeDecisionTreeAnswer(value) !== null;

const isDecisionTreeQuestion = (value) =>
  value &&
  typeof value === 'object' &&
  Number.isInteger(value.id) &&
  typeof value.text === 'string' &&
  value.text.trim().length > 0;

const isDecisionTreeQuestionNode = (value) =>
  value?.type === 'question' &&
  Array.isArray(value.questions) &&
  value.questions.length > 0 &&
  value.questions.every(isDecisionTreeQuestion);

const isDecisionTreeOutcome = (value) =>
  value &&
  typeof value === 'object' &&
  Number.isInteger(value.id) &&
  Number.isInteger(value.acuity) &&
  typeof value.name === 'string' &&
  value.name.trim().length > 0 &&
  typeof value.text === 'string' &&
  value.text.trim().length > 0;

const isDecisionTreeOutcomeNode = (value) =>
  value?.type === 'outcome' && isDecisionTreeOutcome(value.outcome);

const decisionTreeBranchForAnswer = (answer) => {
  const normalized = normalizeDecisionTreeAnswer(answer);
  if (!normalized) {
    throw new DecisionTreeTraversalError(
      `Unsupported decision tree answer: ${answer}`
    );
  }

  return normalized === 'no' ? 'right' : 'left';
};

const validateDecisionTreeEnvelope = (decisionTree) => {
  if (!decisionTree || typeof decisionTree !== 'object') {
    throw new DecisionTreeTraversalError(
      'Decision tree payload must be an object.'
    );
  }
  if (decisionTree.schemaVersion !== 'symptomscreen-decision-tree.v1') {
    throw new DecisionTreeTraversalError(
      'Decision tree payload has an unsupported schemaVersion.'
    );
  }
  if (decisionTree.targetSystem !== 'symptomscreen') {
    throw new DecisionTreeTraversalError(
      'Decision tree payload must target SymptomScreen.'
    );
  }
};

const parseDecisionTreeNode = (nodes, index) => {
  if (index >= nodes.length) {
    throw new DecisionTreeTraversalError(
      'Decision tree ended before a missing-child sentinel was found.'
    );
  }

  const value = nodes[index];
  if (value === null) return { node: null, nextIndex: index + 1 };
  if (value?.type === 'question' && !isDecisionTreeQuestionNode(value)) {
    throw new DecisionTreeTraversalError(
      'Decision tree question node must include at least one valid question.'
    );
  }
  if (value?.type === 'outcome' && !isDecisionTreeOutcomeNode(value)) {
    throw new DecisionTreeTraversalError(
      'Decision tree outcome node must include a valid outcome.'
    );
  }
  if (!isDecisionTreeQuestionNode(value) && !isDecisionTreeOutcomeNode(value)) {
    throw new DecisionTreeTraversalError(
      'Decision tree contains an unsupported node value.'
    );
  }

  const left = parseDecisionTreeNode(nodes, index + 1);
  const right = parseDecisionTreeNode(nodes, left.nextIndex);

  return {
    node: {
      value,
      left: left.node,
      right: right.node
    },
    nextIndex: right.nextIndex
  };
};

const deserializeDecisionTree = (decisionTree) => {
  validateDecisionTreeEnvelope(decisionTree);

  const nodes = decisionTree?.nodes;
  if (!Array.isArray(nodes)) {
    throw new DecisionTreeTraversalError(
      'Decision tree payload did not include a nodes array.'
    );
  }

  const parsed = parseDecisionTreeNode(nodes, 0);
  if (!parsed.node) {
    throw new DecisionTreeTraversalError('Decision tree root is empty.');
  }
  if (parsed.nextIndex !== nodes.length) {
    throw new DecisionTreeTraversalError(
      'Decision tree contains extra nodes after the root tree.'
    );
  }

  return parsed.node;
};

const cloneTargets = (targets) =>
  Array.isArray(targets) ? targets.map((target) => ({ ...target })) : [];

const valueForCurrent = ({ node, questionIndex, targets }) => {
  if (!node) return null;

  if (isDecisionTreeQuestionNode(node.value)) {
    const question = node.value.questions[questionIndex];
    if (!question) return null;

    return {
      type: 'question',
      question: { ...question },
      targets: cloneTargets(targets)
    };
  }

  if (isDecisionTreeOutcomeNode(node.value)) {
    return {
      type: 'outcome',
      outcome: { ...node.value.outcome },
      targets: cloneTargets(targets)
    };
  }

  return null;
};

const nodeAtPath = (root, path) =>
  path.reduce((node, branch) => {
    if (!node) return null;
    return branch === 'left' ? node.left : node.right;
  }, root);

const isDecisionTreeNodePath = (value) =>
  Array.isArray(value) &&
  value.every((branch) => branch === 'left' || branch === 'right');

const initialPosition = (decisionTree, root) => {
  const initialOutcome = decisionTree.initialOutcome;
  const initialCursor = decisionTree.initialCursor;

  if (initialCursor && initialOutcome) {
    throw new DecisionTreeTraversalError(
      'Decision tree cannot include both initialCursor and initialOutcome.'
    );
  }

  if (initialOutcome) {
    if (
      !isDecisionTreeNodePath(initialOutcome.nodePath) ||
      !Number.isInteger(initialOutcome.outcomeId)
    ) {
      throw new DecisionTreeTraversalError(
        'Decision tree initial outcome is malformed.'
      );
    }

    const node = nodeAtPath(root, initialOutcome.nodePath);
    if (!node || !isDecisionTreeOutcomeNode(node.value)) {
      throw new DecisionTreeTraversalError(
        'Decision tree initial outcome does not point to an outcome node.'
      );
    }

    if (node.value.outcome.id !== initialOutcome.outcomeId) {
      throw new DecisionTreeTraversalError(
        'Decision tree initial outcome does not match an outcome in the tree.'
      );
    }

    return { node, questionIndex: 0 };
  }

  if (!initialCursor) return { node: root, questionIndex: 0 };

  if (
    !isDecisionTreeNodePath(initialCursor.nodePath) ||
    !Number.isInteger(initialCursor.questionIndex) ||
    initialCursor.questionIndex < 0 ||
    !Number.isInteger(initialCursor.questionId)
  ) {
    throw new DecisionTreeTraversalError(
      'Decision tree initial cursor is malformed.'
    );
  }

  const node = nodeAtPath(root, initialCursor.nodePath);
  if (!node || !isDecisionTreeQuestionNode(node.value)) {
    throw new DecisionTreeTraversalError(
      'Decision tree initial cursor does not point to a question node.'
    );
  }

  const question = node.value.questions[initialCursor.questionIndex];
  if (!question || question.id !== initialCursor.questionId) {
    throw new DecisionTreeTraversalError(
      'Decision tree initial cursor does not match a question in the tree.'
    );
  }

  return { node, questionIndex: initialCursor.questionIndex };
};

const currentQuestion = (node, questionIndex) => {
  if (!node || !isDecisionTreeQuestionNode(node.value)) return null;
  const question = node.value.questions[questionIndex];
  return question ? { ...question } : null;
};

export const loadDecisionTree = (decisionTree) => {
  const root = deserializeDecisionTree(decisionTree);
  const startingPosition = initialPosition(decisionTree, root);
  let current = startingPosition.node;
  let questionIndex = startingPosition.questionIndex;
  const targets = decisionTree.targets;
  const steps = [];

  return {
    current() {
      return valueForCurrent({ node: current, questionIndex, targets });
    },
    /**
     * Advance with the same value your app would send to /routing/turns as
     * `screeningAnswer.answer`.
     *
     * @param {DecisionTreeAnswer | string} answer
     */
    answer(answer) {
      const normalized = normalizeDecisionTreeAnswer(answer);
      if (!normalized) {
        throw new DecisionTreeTraversalError(
          `Unsupported decision tree answer: ${answer}`
        );
      }

      if (!current || !isDecisionTreeQuestionNode(current.value)) {
        return valueForCurrent({ node: current, questionIndex, targets });
      }

      const branch = decisionTreeBranchForAnswer(normalized);
      const question = currentQuestion(current, questionIndex);
      const nextQuestionIndex = questionIndex + 1;
      if (
        branch === 'right' &&
        nextQuestionIndex < current.value.questions.length
      ) {
        if (question) steps.push({ question, answer: normalized });
        questionIndex = nextQuestionIndex;
        return valueForCurrent({ node: current, questionIndex, targets });
      }

      const next = branch === 'right' ? current.right : current.left;
      if (question) steps.push({ question, answer: normalized });
      current = next;
      questionIndex = 0;
      return valueForCurrent({ node: current, questionIndex, targets });
    },
    reset() {
      current = startingPosition.node;
      questionIndex = startingPosition.questionIndex;
      steps.splice(0, steps.length);
      return valueForCurrent({ node: current, questionIndex, targets });
    },
    isComplete() {
      return !current || isDecisionTreeOutcomeNode(current.value);
    },
    history() {
      return steps.map((step) => ({
        question: { ...step.question },
        answer: step.answer
      }));
    }
  };
};
