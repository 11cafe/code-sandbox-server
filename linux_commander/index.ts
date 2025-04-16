#!/usr/bin/env node

import express, { Request, Response as ExpressResponse } from "express";
import { ChildProcessWithoutNullStreams, spawn } from "child_process";
import pty from "node-pty";
import { nanoid } from "nanoid";
import { z } from "zod";
import stripAnsi from "strip-ansi";

const app = express();
const port = process.env.PORT || 3000;
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
// const PROCESS_TIMEOUT_MS = 10 * 1000; // 10 seconds timeout
// const PROCESS_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes timeout
// app.post(
//   "/execute_command",
//   (
//     req: Request<{}, {}, { command: string; timeout?: number }>,
//     res: Response
//   ) => {
//     // check authorization
//     const API_KEY = process.env.API_KEY;
//     if (API_KEY?.length) {
//       const { authorization } = req.headers;
//       if (!authorization || authorization !== `Bearer ${API_KEY}`) {
//         return res.status(401).json({ error: "Unauthorized API Key" });
//       }
//     }

//     const { command, timeout = PROCESS_TIMEOUT_MS } = req.body;

//     // Basic validation
//     if (!command || typeof command !== "string") {
//       console.error("Invalid command", command);
//       return res
//         .status(400)
//         .json({ error: "Invalid request: command is required" });
//     }

//     // Set response headers for streaming
//     res.setHeader("Content-Type", "text/plain");
//     res.setHeader("Transfer-Encoding", "chunked");

//     // TODO: support interactive command
//     // Use shell to properly interpret the command
//     const execProcess = spawn(command, [], {
//       shell: true,
//       env: process.env,
//       cwd: process.cwd(),
//     });

//     // Add timeout to kill long-running processes
//     const timeoutId = setTimeout(() => {
//       if (execProcess.pid) {
//         try {
//           execProcess.kill();
//         } catch (error) {}
//         res.write("\nError: Process timed out after 5 minutes\n");
//         res.end();
//       }
//     }, timeout);

//     // Handle client disconnect
//     req.on("close", () => {
//       // cannot kill the process here, it will early exit the process resulting blank resp sometimes
//       // execProcess.kill();
//     });

//     // Stream stdout
//     execProcess.stdout.on("data", (data) => {
//       res.write(data);
//     });

//     // Stream stderr
//     execProcess.stderr.on("data", (data) => {
//       res.write(`ERROR: ${data}`);
//     });

//     // Check if process is trying to read from TTY (interactive)
//     execProcess.stdin.on("data", () => {
//       console.log("📖reading from stdin");
//       execProcess.kill();
//       res.write("Error: Interactive commands are not supported\n");
//       res.end();
//     });

//     // Handle process completion
//     execProcess.on("close", (code) => {
//       clearTimeout(timeoutId);
//       res.end();
//     });

//     // Handle errors
//     execProcess.on("error", (err) => {
//       clearTimeout(timeoutId);
//       res.write(`\nError: ${err.message}`);
//       res.end();
//     });
//   }
// );

// Start the server
app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
