import express, { Request, Response } from "express";
import { spawn } from "child_process";

const app = express();
const port = process.env.PORT || 3000;

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
      return res.status(400).json({ error: "Invalid command" });
    }

    // Set response headers for streaming
    res.setHeader("Content-Type", "text/plain");
    res.setHeader("Transfer-Encoding", "chunked");

    // Use shell to properly interpret the command
    const execProcess = spawn(command, [], {
      shell: true,
      env: process.env,
    });

    // Handle client disconnect
    req.on("close", () => {
      try {
        if (execProcess.pid) {
          execProcess.kill(); // Use the built-in kill method instead
        }
      } catch (error) {
        console.error("Error killing process:", error);
      }
    });

    // Stream stdout
    execProcess.stdout.on("data", (data) => {
      res.write(data);
    });

    // Stream stderr
    execProcess.stderr.on("data", (data) => {
      res.write(`ERROR: ${data}`);
    });

    // Handle process completion
    execProcess.on("close", (code) => {
      res.write(`\nProcess exited with code ${code}`);
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
