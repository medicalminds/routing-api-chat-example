const answerValues = new Set(['yes', 'no', 'maybe', 'unsure', 'unclear']);

export class DecisionTreeTraversalError extends Error {
  constructor(message) {
    super(message);
    this.name = 'DecisionTreeTraversalError';
  }
}

export const normalizeDecisionTreeAnswer = (value) => {
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

export const isDecisionTreeQuestionNode = (value) =>
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

export const isDecisionTreeOutcomeNode = (value) =>
  value?.type === 'outcome' && isDecisionTreeOutcome(value.outcome);

export const decisionTreeBranchForAnswer = (answer) => {
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

const cloneDecisionTreeValue = (value) => {
  if (isDecisionTreeQuestionNode(value)) {
    return {
      ...value,
      questions: value.questions.map((question) => ({ ...question }))
    };
  }
  if (isDecisionTreeOutcomeNode(value)) {
    return {
      ...value,
      outcome: { ...value.outcome }
    };
  }
  return value;
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

export const deserializeDecisionTree = (decisionTree) => {
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

const valueForCursor = (node, questionIndex) => {
  if (!node) return null;
  if (!isDecisionTreeQuestionNode(node.value)) {
    return cloneDecisionTreeValue(node.value);
  }

  return {
    ...node.value,
    questions: [{ ...node.value.questions[questionIndex] }]
  };
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

export const createDecisionTreeCursor = (decisionTree) => {
  const root = deserializeDecisionTree(decisionTree);
  const startingPosition = initialPosition(decisionTree, root);
  let current = startingPosition.node;
  let questionIndex = startingPosition.questionIndex;
  const steps = [];

  return {
    current() {
      return valueForCursor(current, questionIndex);
    },
    currentNode() {
      return current;
    },
    currentQuestionIndex() {
      return questionIndex;
    },
    answer(answer) {
      const normalized = normalizeDecisionTreeAnswer(answer);
      if (!normalized) {
        throw new DecisionTreeTraversalError(
          `Unsupported decision tree answer: ${answer}`
        );
      }

      if (!current || !isDecisionTreeQuestionNode(current.value)) {
        return current?.value ?? null;
      }

      const branch = decisionTreeBranchForAnswer(normalized);
      const nextQuestionIndex = questionIndex + 1;
      if (
        branch === 'right' &&
        nextQuestionIndex < current.value.questions.length
      ) {
        const next = valueForCursor(current, nextQuestionIndex);
        steps.push({
          question: valueForCursor(current, questionIndex),
          questionIndex,
          answer: normalized,
          branch,
          next
        });
        questionIndex = nextQuestionIndex;
        return next;
      }

      const next = branch === 'right' ? current.right : current.left;
      steps.push({
        question: valueForCursor(current, questionIndex),
        questionIndex,
        answer: normalized,
        branch,
        next: valueForCursor(next, 0)
      });
      current = next;
      questionIndex = 0;
      return valueForCursor(current, questionIndex);
    },
    reset() {
      current = startingPosition.node;
      questionIndex = startingPosition.questionIndex;
      steps.splice(0, steps.length);
      return valueForCursor(current, questionIndex);
    },
    isComplete() {
      return !current || isDecisionTreeOutcomeNode(current.value);
    },
    path() {
      return [...steps];
    }
  };
};
