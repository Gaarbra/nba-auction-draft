import test from "node:test";
import assert from "node:assert/strict";
import { mapWithConcurrency } from "./concurrency.js";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test("mapWithConcurrency: preserves output order regardless of completion order", async () => {
  const items = [30, 10, 20, 5, 25];
  const results = await mapWithConcurrency(items, 3, async (ms) => {
    await sleep(ms);
    return ms;
  });
  assert.deepStrictEqual(results, items);
});

test("mapWithConcurrency: never runs more than `limit` mappers at once", async () => {
  let inFlight = 0;
  let maxInFlight = 0;
  const items = Array.from({ length: 10 }, (_, i) => i);

  await mapWithConcurrency(items, 3, async (item) => {
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await sleep(10);
    inFlight -= 1;
    return item * 2;
  });

  assert.ok(maxInFlight <= 3, `expected at most 3 concurrent, saw ${maxInFlight}`);
});

test("mapWithConcurrency: limit larger than the item count doesn't crash or over-run", async () => {
  const items = [1, 2, 3];
  const results = await mapWithConcurrency(items, 10, async (n) => n * 10);
  assert.deepStrictEqual(results, [10, 20, 30]);
});

test("mapWithConcurrency: empty input returns empty output", async () => {
  const results = await mapWithConcurrency([], 4, async (n) => n);
  assert.deepStrictEqual(results, []);
});

test("mapWithConcurrency: a rejected mapper call propagates as a rejection, not a silent gap", async () => {
  const items = [1, 2, 3];
  await assert.rejects(
    () =>
      mapWithConcurrency(items, 2, async (n) => {
        if (n === 2) throw new Error("boom");
        return n;
      }),
    /boom/
  );
});
