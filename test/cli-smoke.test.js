import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import test from 'node:test';

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

const readJsonBody = (req) =>
  new Promise((resolve) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      resolve(body ? JSON.parse(body) : {});
    });
  });

const sendJson = (res, body, status = 200) => {
  res.writeHead(status, {
    'content-type': 'application/json'
  });
  res.end(JSON.stringify(body));
};

const createMockRoutingApi = ({
  inlineDecisionTree = true,
  turnDecisionTree = false
} = {}) => {
  const requests = [];
  const server = http.createServer(async (req, res) => {
    const body = await readJsonBody(req);
    requests.push({
      method: req.method,
      url: req.url,
      body
    });

    if (req.method === 'POST' && req.url === '/api/routing/sessions') {
      const response = {
        sessionToken: 'token-screening',
        nextAction: {
          type: 'ask',
          question: {
            id: 501,
            text: 'Do they have trouble breathing?',
            inputKind: 'single_select',
            options: [
              {
                id: 'yes',
                label: 'Yes'
              },
              {
                id: 'no',
                label: 'No'
              }
            ]
          }
        }
      };
      if (inlineDecisionTree) response.decisionTree = decisionTree;
      sendJson(res, response);
      return;
    }

    if (req.method === 'POST' && req.url === '/api/routing/decision-tree') {
      sendJson(res, { decisionTree });
      return;
    }

    if (req.method === 'POST' && req.url === '/api/routing/turns') {
      const response = {
        sessionToken: 'token-resolved',
        nextAction: {
          type: 'resolved',
          targets: [
            {
              targetSystem: 'symptomscreen',
              id: 95,
              title: 'Rash or Redness - Widespread'
            }
          ],
          screening: {
            priorityId: 7,
            outcomeText: 'Home care',
            screeningNote: 'Screening note from mock API.'
          }
        }
      };
      if (turnDecisionTree) response.decisionTree = decisionTree;
      sendJson(res, response);
      return;
    }

    sendJson(
      res,
      {
        status: 'error',
        message: `Unexpected ${req.method} ${req.url}`
      },
      404
    );
  });

  return { requests, server };
};

const listen = (server) =>
  new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve(server.address().port);
    });
  });

const close = (server) =>
  new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });

test('CLI can load an inline decision tree while sending normal turns', async () => {
  const { requests, server } = createMockRoutingApi({ turnDecisionTree: true });
  const port = await listen(server);

  const child = spawn(
    process.execPath,
    [
      './src/cli.js',
      '--base-url',
      `http://127.0.0.1:${port}/api`,
      '--api-key',
      'test-key',
      '--mode',
      'byo',
      '--target-system',
      'symptomscreen',
      '--decision-tree=inline'
    ],
    {
      cwd: process.cwd(),
      stdio: ['pipe', 'pipe', 'pipe']
    }
  );

  let stdout = '';
  let stderr = '';
  let sentInput = false;
  child.stdout.on('data', (chunk) => {
    stdout += chunk;
    if (!sentInput && stdout.includes('Choose an option')) {
      sentInput = true;
      child.stdin.write(':tree\n');
      setTimeout(() => child.stdin.write(':tree maybe\n'), 20);
      setTimeout(() => child.stdin.write('2\n'), 40);
    }
  });
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });

  const timeout = setTimeout(() => {
    child.kill('SIGKILL');
  }, 5000);
  const exitCode = await new Promise((resolve) => {
    child.on('close', resolve);
  });
  clearTimeout(timeout);
  await close(server);

  assert.equal(exitCode, 0, stdout);
  assert.equal(stderr.trim(), '');

  for (const text of [
    'Loaded Rash or Redness - Widespread.',
    'no advances through grouped questions first',
    'Current outcome node',
    'Outcome: Go now',
    'Screening outcome: Home care'
  ]) {
    assert.match(
      stdout,
      new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    );
  }
  assert.equal(
    stdout.match(/Loaded Rash or Redness - Widespread\./g)?.length,
    1
  );

  const start = requests.find(
    (request) => request.url === '/api/routing/sessions'
  );
  const turn = requests.find((request) => request.url === '/api/routing/turns');

  assert.equal(start.body.responseOptions.includeDecisionTree, true);
  assert.equal(turn.body.screeningAnswer.questionId, 501);
  assert.equal(turn.body.screeningAnswer.answer, 'no');
  assert.equal(turn.body.responseOptions, undefined);
});

test('CLI can fetch a decision tree from the dedicated endpoint', async () => {
  const { requests, server } = createMockRoutingApi({
    inlineDecisionTree: false
  });
  const port = await listen(server);

  const child = spawn(
    process.execPath,
    [
      './src/cli.js',
      '--base-url',
      `http://127.0.0.1:${port}/api`,
      '--api-key',
      'test-key',
      '--mode',
      'byo',
      '--target-system',
      'symptomscreen',
      '--decision-tree=fetch'
    ],
    {
      cwd: process.cwd(),
      stdio: ['pipe', 'pipe', 'pipe']
    }
  );

  let stdout = '';
  let stderr = '';
  let sentInput = false;
  child.stdout.on('data', (chunk) => {
    stdout += chunk;
    if (!sentInput && stdout.includes('Choose an option')) {
      sentInput = true;
      child.stdin.write(':tree unsure\n');
      setTimeout(() => child.stdin.write('2\n'), 20);
    }
  });
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });

  const timeout = setTimeout(() => {
    child.kill('SIGKILL');
  }, 5000);
  const exitCode = await new Promise((resolve) => {
    child.on('close', resolve);
  });
  clearTimeout(timeout);
  await close(server);

  assert.equal(exitCode, 0, stdout);
  assert.equal(stderr.trim(), '');
  assert.match(stdout, /Loaded Rash or Redness - Widespread\./);
  assert.match(stdout, /Outcome: Go now/);
  assert.match(stdout, /Screening outcome: Home care/);

  const start = requests.find(
    (request) => request.url === '/api/routing/sessions'
  );
  const tree = requests.find(
    (request) => request.url === '/api/routing/decision-tree'
  );
  const turn = requests.find((request) => request.url === '/api/routing/turns');

  assert.equal(start.body.responseOptions, undefined);
  assert.deepEqual(tree.body, { sessionToken: 'token-screening' });
  assert.equal(turn.body.screeningAnswer.answer, 'no');
  assert.equal(turn.body.responseOptions, undefined);
});

test('CLI rejects decision-tree mode for ClearTriage sessions', async () => {
  const child = spawn(
    process.execPath,
    [
      './src/cli.js',
      '--base-url',
      'http://127.0.0.1:9/api',
      '--api-key',
      'test-key',
      '--mode',
      'byo',
      '--target-system',
      'cleartriage',
      '--decision-tree'
    ],
    {
      cwd: process.cwd(),
      stdio: ['pipe', 'pipe', 'pipe']
    }
  );

  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => {
    stdout += chunk;
  });
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });

  const exitCode = await new Promise((resolve) => {
    child.on('close', resolve);
  });

  assert.equal(exitCode, 1, stdout);
  assert.match(
    stderr,
    /decision-tree demo is only available for SymptomScreen/
  );
});
