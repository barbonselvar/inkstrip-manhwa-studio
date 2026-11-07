import assert from "node:assert/strict";
import { test } from "node:test";
import { StartupOutputGate } from "../apps/desktop/test/startup-output-gate.mjs";

test("browser attachment waits for real readiness; Node debugger and errors do not", () => {
  const output = [];
  const gate = new StartupOutputGate((channel, line) => output.push([channel, line]));
  gate.push("stderr", "Debugger listening on ws://node\n");
  gate.push("stderr", "DevTools listening on ws://browser\n");
  gate.push("stderr", "An actual application error\n");
  assert.deepEqual(output, [
    ["stderr", "Debugger listening on ws://node\n"],
    ["stderr", "An actual application error\n"],
  ]);
  assert.equal(gate.ready, false);
  gate.push("stdout", "2026-11-07 INFO Inkstrip 1.1.0 started (Electron 45.2.3)\n");
  assert.equal(gate.ready, true);
  assert.equal(output.at(-1)[1], "DevTools listening on ws://browser\n");
});

test("split chunks and readiness before endpoint preserve the announcement", () => {
  const output = [];
  const gate = new StartupOutputGate((_channel, line) => output.push(line));
  gate.push("stdout", "INFO Inkstrip 1.1.0 sta");
  gate.push("stdout", "rted (Electron 45.2.3)\n");
  gate.push("stderr", "DevTools list");
  gate.push("stderr", "ening on ws://browser\n");
  assert.deepEqual(output, [
    "INFO Inkstrip 1.1.0 started (Electron 45.2.3)\n",
    "DevTools listening on ws://browser\n",
  ]);
});

test("a startup failure is never converted into readiness", () => {
  const output = [];
  const gate = new StartupOutputGate((_channel, line) => output.push(line));
  gate.push("stderr", "DevTools listening on ws://browser\nFatal startup exception");
  gate.end();
  assert.equal(gate.ready, false);
  assert.equal(output.includes("Fatal startup exception"), true);
  assert.equal(output.some((line) => line.startsWith("DevTools listening")), false);
  assert.match(output.at(-1), /exited before/);
});
