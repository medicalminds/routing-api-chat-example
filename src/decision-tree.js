const answerValues = new Set(['yes', 'no', 'maybe', 'unsure', 'unclear']);

export class DecisionTreeTraversalError extends Error {
  constructor(message) {
    super(message);
    this.name = 'DecisionTreeTraversalError';
  }
}

export const isDecisionTreeAnswer = (value) => answerValues.has(value);

export const isDecisionTreeQuestionNode = (value) => value?.type === 'question';

export const isDecisionTreeOutcomeNode = (value) => value?.type === 'outcome';

export const decisionTreeBranchForAnswer = (answer) => {
  if (!isDecisionTreeAnswer(answer)) {
    throw new DecisionTreeTraversalError(
      `Unsupported decision tree answer: ${answer}`
    );
  }

  return answer === 'no' ? 'right' : 'left';
};

const parseDecisionTreeNode = (nodes, index) => {
  if (index >= nodes.length) {
    throw new DecisionTreeTraversalError(
      'Decision tree ended before a missing-child sentinel was found.'
    );
  }

  const value = nodes[index];
  if (value === null) return { node: null, nextIndex: index + 1 };
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

export const createDecisionTreeCursor = (decisionTree) => {
  const root = deserializeDecisionTree(decisionTree);
  let current = root;
  const steps = [];

  return {
    current() {
      return current?.value ?? null;
    },
    currentNode() {
      return current;
    },
    answer(answer) {
      if (!isDecisionTreeAnswer(answer)) {
        throw new DecisionTreeTraversalError(
          `Unsupported decision tree answer: ${answer}`
        );
      }

      if (!current || !isDecisionTreeQuestionNode(current.value)) {
        return current?.value ?? null;
      }

      const branch = decisionTreeBranchForAnswer(answer);
      const next = branch === 'right' ? current.right : current.left;
      steps.push({
        question: current.value,
        answer,
        branch,
        next: next?.value ?? null
      });
      current = next;
      return current?.value ?? null;
    },
    reset() {
      current = root;
      steps.splice(0, steps.length);
      return current.value;
    },
    isComplete() {
      return !current || isDecisionTreeOutcomeNode(current.value);
    },
    path() {
      return [...steps];
    }
  };
};
