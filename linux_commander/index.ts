#!/usr/bin/env node

import express, { Request, Response as ExpressResponse } from "express";
import { ChildProcessWithoutNullStreams, spawn } from "child_process";
import pty from "node-pty";
import { nanoid } from "nanoid";
import { z } from "zod";
import stripAnsi from "strip-ansi";

const app = express();
const port = process.env.PORT || 9409;
const runningTerminals: {
  [key: string]: {
    startedAt: number;
    execProcess: ChildProcessWithoutNullStreams;
  };
} = {};

// Middleware for parsing JSON bodies
app.use(express.json());

// Basic route
app.get("/", (req, res) => {
  res.json({ message: "Welcome to Linux Commander" });
});

type Terminal = {
  id: string;
  pty: pty.IPty;
  status: "initializing" | "ready" | "running";
  createdAt: number;
};
let terminalMap: {
  [key: string]: Terminal;
} = {};

async function createTerminal(): Promise<Terminal> {
  const startTime2 = performance.now();
  // Directly run the container bash as the main process
  const ptyProcess = pty.spawn("/bin/bash", [], {
    name: "xterm-color",
    cols: 80,
    rows: 30,
    cwd: process.env.HOME,
    env: process.env,
  });
  const newTerminal: Terminal = {
    id: nanoid(),
    pty: ptyProcess,
    status: "initializing",
    createdAt: Date.now(),
  };
  terminalMap[newTerminal.id] = newTerminal;
  // Pipe terminal output to stdout
  // ptyProcess.onData((data) => {
  //   process.stdout.write(data);
  // });

  let buffer = "";
  const cleanup = ptyProcess.onData((data) => {
    buffer += data;
    if (buffer.includes("$ ") || buffer.includes("# ")) {
      // Shell is ready — send the command
      newTerminal.status = "ready";
      buffer = ""; // reset if needed
      cleanup.dispose();
    }
  });
  while (newTerminal.status !== "ready") {
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  const endTime2 = performance.now();
  console.log(`Terminal created took ${(endTime2 - startTime2) / 1000}s`);
  return newTerminal;
}

async function createCodeServer() {
  const codeServer = spawn("code-server", [
    "/home",
    "--host",
    "0.0.0.0",
    "--port",
    "9999",
  ]);
  return codeServer;
}

app.post(
  "/execute_command",
  async (
    req: Request<
      {},
      {},
      {
        command: string;
      }
    >,
    res: ExpressResponse
  ) => {
    const { command } = req.body;

    let terminal = Object.values(terminalMap).find((t) => t.status === "ready");
    if (!terminal) {
      try {
        terminal = await createTerminal();
      } catch (error) {
        console.error(`Error creating terminal: ${error}`);
        return res
          .status(500)
          .json({ error: `Error creating terminal: ${error}` });
      }
    }
    const ptyProcess = terminal.pty;

    const sentinel = `__END_SIG_${nanoid(2)}__`;
    const escapedCommand = command.replace(/'/g, `'\\''`);
    const wrapped = `sh -c '${escapedCommand}; echo ${sentinel}'`;
    const timeout = 8 * 1000;
    let buffer = "";
    // because the SENTINEL would appear twice, first time when command invoked, should be ignored
    terminal.status = "running";
    const timeoutId = setTimeout(() => {
      if (terminal.status === "running") {
        res.json({
          text: `Command not finished running in 15s, you can use terminal_id ${
            terminal.id
          } to view the execution output later. Current output: \n ${stripAnsi(
            buffer
          )}`,
        });
        listener.dispose();

        // restart terminal
        // killTerminal(sandbox_id, terminal.id);
        // createTerminal(sandbox_id);
      }
    }, timeout);
    const listener = ptyProcess.onData((data) => {
      console.log(stripAnsi(data));
      // res.write(data);
      buffer += data;
      const sentinelCount = (buffer.match(new RegExp(sentinel, "g")) || [])
        .length;
      if (sentinelCount >= 2) {
        // command finished after seeing second sentinel

        res.json({
          // status: "finished",
          text: stripAnsi(buffer),
        });
        listener.dispose();
        clearTimeout(timeoutId);

        terminal.status = "ready";
      }
    });
    ptyProcess.write(`${wrapped}\r`);
  }
);

// Start the server
app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
