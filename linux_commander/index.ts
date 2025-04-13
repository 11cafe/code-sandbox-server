#!/usr/bin/env node

import express, { Request, Response } from "express";
import { ChildProcessWithoutNullStreams, spawn } from "child_process";

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

// Update the route to handle errors
app.post(
  "/api/command",
  (req: Request<{}, {}, { command: string }>, res: Response) => {
    // check authorization
    const API_KEY = process.env.API_KEY;
    if (API_KEY?.length) {
      const { authorization } = req.headers;
      if (!authorization || authorization !== `Bearer ${API_KEY}`) {
        return res.status(401).json({ error: "Unauthorized API Key" });
      }
    }

    const { command } = req.body;

    // Basic validation
    if (!command || typeof command !== "string") {
      console.error("Invalid command", command);
      return res.status(400).json({ error: "Invalid command" });
    }

    // Set response headers for streaming
    res.setHeader("Content-Type", "text/plain");
    res.setHeader("Transfer-Encoding", "chunked");

    // Use shell to properly interpret the command
    const execProcess = spawn(command, [], {
      shell: true,
      env: process.env,
      cwd: process.cwd(),
    });
    if (execProcess.pid) {
      runningTerminals[execProcess.pid] = {
        startedAt: Date.now(),
        execProcess,
      };
    }

    // Handle client disconnect
    req.on("close", () => {
      // cannot kill the process here, it will early exit the process resulting blank resp sometimes
      // execProcess.kill();
    });

    // Stream stdout
    execProcess.stdout.on("data", (data) => {
      res.write(data);
    });

    // Stream stderr
    execProcess.stderr.on("data", (data) => {
      res.write(`ERROR: ${data}`);
    });

    // Check if process is trying to read from TTY (interactive)
    execProcess.stdin.on("data", () => {
      console.log("📖reading from stdin");
      execProcess.kill();
      res.write("Error: Interactive commands are not supported\n");
      res.end();
    });

    // Handle process completion
    execProcess.on("close", (code) => {
      res.end();
    });

    // Handle errors
    execProcess.on("error", (err) => {
      res.write(`\nError: ${err.message}`);

      res.end();
    });
  }
);

// Start the server
app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
