import { test } from "node:test";
import assert from "node:assert/strict";
import { startSerialPoll } from "../lib/serial-poll";

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

test("100 ticks during a slow read make one request and stopping fences its result", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  let requests = 0;
  let writes = 0;
  let release!: () => void;
  const waiting = new Promise<void>((resolve) => { release = resolve; });
  const stop = startSerialPoll(async (stopped) => {
    requests++;
    await waiting;
    if (!stopped()) writes++;
  }, 600);
  t.mock.timers.tick(600);
  await flush();
  t.mock.timers.tick(600 * 100);
  await flush();
  assert.equal(requests, 1);
  stop();
  release();
  await flush();
  assert.equal(writes, 0);
  t.mock.timers.tick(6000);
  await flush();
  assert.equal(requests, 1);
});

test("a rejected read releases the gate for the next tick", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  let requests = 0;
  const stop = startSerialPoll(async () => { requests++; throw new Error("offline"); }, 600);
  t.mock.timers.tick(600);
  await flush();
  t.mock.timers.tick(600);
  await flush();
  assert.equal(requests, 2);
  stop();
});
