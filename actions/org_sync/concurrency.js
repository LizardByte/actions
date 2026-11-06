// Keep independent operations bounded while retaining their input order.
async function mapConcurrent(items, concurrency, operation) {
  const results = new Array(items.length);
  let nextIndex = 0;
  async function worker() {
    const index = nextIndex++;
    if (index >= items.length) return;
    results[index] = await operation(items[index]);
    return worker();
  }
  const workers = await Promise.allSettled(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  const failed = workers.find(result => result.status === 'rejected');
  if (failed) throw failed.reason;
  return results;
}

module.exports = { mapConcurrent };
