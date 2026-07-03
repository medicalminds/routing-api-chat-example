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
  if (!isDecisionTreeQuestionNode(node.value)) return node.value;

  return {
    ...node.value,
    questions: [node.value.questions[questionIndex]]
  };
};

export const createDecisionTreeCursor = (decisionTree) => {
  const root = deserializeDecisionTree(decisionTree);
  let current = root;
  let questionIndex = 0;
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
      current = root;
      questionIndex = 0;
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
