import * as ops from './ops.js';

self.onmessage = (e) => {
  const { id, op, args } = e.data;
  try {
    const result = ops[op](args, (value) => self.postMessage({ id, type: 'progress', value }));
    self.postMessage({ id, type: 'done', result });
  } catch (err) {
    self.postMessage({ id, type: 'error', message: String((err && err.message) || err) });
  }
};
