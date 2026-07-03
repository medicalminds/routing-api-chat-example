const DEFAULT_BASE_URL = 'http://localhost:5555/api';

export class RoutingApiError extends Error {
  constructor(status, apiError) {
    super(apiErrorMessage(apiError));
    this.name = 'RoutingApiError';
    this.status = status;
    this.apiError = apiError;
  }
}

export class RoutingInvalidResponseError extends Error {
  constructor(message, status, details) {
    super(message);
    this.name = 'RoutingInvalidResponseError';
    this.status = status;
    this.details = details;
  }
}

const apiErrorMessage = (apiError) => {
  if (apiError && typeof apiError === 'object') {
    if (typeof apiError.message === 'string') return apiError.message;
    if (typeof apiError.error === 'string') return apiError.error;
  }
  return 'The Routing API rejected the request.';
};

export const joinUrl = (baseUrl, path) => {
  const normalizedBase = (baseUrl || DEFAULT_BASE_URL)
    .trim()
    .replace(/\/+$/, '');
  const normalizedPath = path.replace(/^\/+/, '');
  return `${normalizedBase}/${normalizedPath}`;
};

const readJsonResponse = async (response) => {
  const text = await response.text();
  if (!text.trim()) {
    throw new RoutingInvalidResponseError(
      'The Routing API returned an empty response body.',
      response.status
    );
  }

  try {
    return JSON.parse(text);
  } catch (error) {
    throw new RoutingInvalidResponseError(
      'The Routing API returned a response body that was not valid JSON.',
      response.status,
      error
    );
  }
};

// Treat error-shaped JSON as a Routing API error even if the HTTP status is
// unexpectedly successful, so CLI callers get the same error path either way.
const looksLikeApiError = (value) =>
  value &&
  typeof value === 'object' &&
  (typeof value.message === 'string' || typeof value.error === 'string');

const validateSessionResponse = (value, status) => {
  if (!value || typeof value !== 'object') {
    throw new RoutingInvalidResponseError(
      'The Routing API response was not a JSON object.',
      status,
      value
    );
  }

  if (typeof value.sessionToken !== 'string' || !value.sessionToken) {
    throw new RoutingInvalidResponseError(
      'The Routing API response did not include a sessionToken string.',
      status,
      value
    );
  }

  if (!value.nextAction || typeof value.nextAction !== 'object') {
    throw new RoutingInvalidResponseError(
      'The Routing API response did not include a nextAction object.',
      status,
      value
    );
  }

  if (typeof value.nextAction.type !== 'string') {
    throw new RoutingInvalidResponseError(
      'The Routing API nextAction did not include a type.',
      status,
      value
    );
  }

  return value;
};

const validateDecisionTreeResponse = (value, status) => {
  if (!value || typeof value !== 'object') {
    throw new RoutingInvalidResponseError(
      'The Routing API decision tree response was not a JSON object.',
      status,
      value
    );
  }

  if (!value.decisionTree || typeof value.decisionTree !== 'object') {
    throw new RoutingInvalidResponseError(
      'The Routing API decision tree response did not include a decisionTree object.',
      status,
      value
    );
  }

  if (!Array.isArray(value.decisionTree.nodes)) {
    throw new RoutingInvalidResponseError(
      'The Routing API decision tree response did not include a nodes array.',
      status,
      value
    );
  }

  return value;
};

const postJson = async (
  { baseUrl, headers = {}, fetchImpl = fetch },
  path,
  body,
  validateResponse
) => {
  const response = await fetchImpl(joinUrl(baseUrl, path), {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      ...headers
    },
    body: JSON.stringify(body)
  });
  const json = await readJsonResponse(response);

  if (!response.ok || looksLikeApiError(json)) {
    throw new RoutingApiError(response.status, json);
  }

  return validateResponse(json, response.status);
};

export const createRoutingApiClient = (options = {}) => ({
  startSession: (body) =>
    postJson(options, '/routing/sessions', body, validateSessionResponse),
  advanceSession: (body) =>
    postJson(options, '/routing/turns', body, validateSessionResponse),
  getDecisionTree: (body) =>
    postJson(
      options,
      '/routing/decision-tree',
      body,
      validateDecisionTreeResponse
    )
});
