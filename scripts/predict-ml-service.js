const DEFAULT_ENDPOINT = process.env.ML_SERVICE_URL || 'http://127.0.0.1:8000';
const PREDICT_PATH = '/predict';
const cache = new Map();

function buildKey(payloads, options) {
  return JSON.stringify({ payloads, options });
}

async function predict(payloads, options = {}) {
  if (!Array.isArray(payloads) || !payloads.length) {
    throw new Error('predict requires a non-empty array of payload objects');
  }
  const body = {
    payloads,
    model_path: options.modelPath,
    include_probabilities: options.includeProbabilities ?? true,
  };
  const endpoint = (options.baseUrl || DEFAULT_ENDPOINT) + PREDICT_PATH;
  const cacheKey = options.disableCache ? null : buildKey(body, endpoint);
  if (cacheKey && cache.has(cacheKey)) {
    return cache.get(cacheKey);
  }
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Prediction request failed: ${response.status} ${detail}`);
  }
  const data = await response.json();
  if (cacheKey) {
    cache.set(cacheKey, data);
    if (cache.size > 50) {
      cache.delete(cache.keys().next().value);
    }
  }
  return data;
}

module.exports = {
  predict,
};
