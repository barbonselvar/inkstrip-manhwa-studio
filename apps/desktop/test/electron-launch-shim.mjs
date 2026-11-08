/** Windows test process only. Forward argv, environment, errors and exit status. */
import { spawn } from "node:child_process";
import { StartupOutputGate } from "./startup-output-gate.mjs";

const [executable, ...args] = process.argv.slice(2);
if (!executable) throw new Error("An Electron executable is required");
const gate = new StartupOutputGate((channel, text) => process[channel].write(text));
const child = spawn(executable, args, { stdio: ["inherit", "pipe", "pipe"], windowsHide: false });
for (const channel of ["stdout", "stderr"]) {
  child[channel].setEncoding("utf8");
  child[channel].on("data", (chunk) => gate.push(channel, chunk));
}
child.on("error", (error) => {
  process.stderr.write("[desktop driver] Child launch failed: " + error.stack + "\n");
  process.exitCode = 1;
});
child.on("close", (code) => {
  gate.end();
  process.exitCode = Number.isInteger(code) ? code : 1;
});
