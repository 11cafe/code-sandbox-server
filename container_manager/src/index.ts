import express, {
  Request,
  Response as ExpressResponse,
  NextFunction,
} from "express";
import { z } from "zod";
import {
  DockerService,
  FileService,
  getContainerWorkspacePath,
} from "./docker-service";
import * as pty from "node-pty";
import { nanoid } from "nanoid";
import stripAnsi from "strip-ansi";
import path from "path";
import fs from "fs/promises";

const app = express();

const getPortFromArgs = () => {
  const portArg = process.argv.find((arg) => arg.startsWith("--port="));
  if (portArg) {
    const port = parseInt(portArg.split("=")[1]);
    if (!isNaN(port)) return port;
  }
  return null;
};

const port = getPortFromArgs() || process.env.PORT || 8888;

// Middleware
app.use(express.json());

// Validation middleware
const validateSchema = <T extends z.ZodType>(schema: T) => {
  return (req: Request, res: ExpressResponse, next: NextFunction) => {
    const result = schema.safeParse(req.body);

    if (!result.success) {
      return res.status(400).json({
        error: "Invalid request parameters: " + result.error.message,
      });
    }

    // Add the validated and typed data to the request
    req.body = result.data;
    next();
  };
};
const validateAuth = (
  req: Request,
  res: ExpressResponse,
  next: NextFunction
) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  if (authHeader !== process.env.API_KEY) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
};

// Routes
app.get("/", (req: Request, res: ExpressResponse) => {
  res.json({ message: "Welcome to container manager!" });
});

const dockerService = new DockerService();

type Terminal = {
  id: string;
  pty: pty.IPty;
  status: "initializing" | "ready" | "running";
  createdAt: number;
};
let terminalMap: {
  [key: string]: Terminal[];
} = {};

// Define schemas for API endpoints
const createSandboxSchema = z.object({
  // with_file_path: z.string().optional(),
  // with_file_content: z.string().optional(),
});

// sudo netstat -tulpn | grep :8888
// curl http://localhost:8888/api/tools/create_sandbox -X POST -H "Content-Type: application/json" -d '{}'
app.post(
  "/api/tools/create_sandbox",
  // validateSchema(createSandboxSchema),
  // validateAuth,
  async (
    req: Request<{}, {}, z.infer<typeof createSandboxSchema>>,
    res: ExpressResponse<{
      sandbox_id: string;
      url: string;
      text: string;
    }>
  ) => {
    const { sandboxId, serverName } = await dockerService.createContainer();
    const url = `http://${serverName}.runbox.ai/?folder=/home`;
    res.json({
      sandbox_id: sandboxId,
      url,
      text: `Created sandbox ${sandboxId} Display this to user again: VIEW YOUR FILE at ${url}`,
    });
  }
);

const serveWebsiteAtPortSchema = z.object({
  port: z.number().min(1, "Port is required"),
  sandbox_id: z.string().min(1, "Sandbox ID is required"),
});
app.post(
  "/api/tools/expose_port",
  validateSchema(serveWebsiteAtPortSchema),
  // validateAuth,
  async (
    req: Request<{}, {}, z.infer<typeof serveWebsiteAtPortSchema>>,
    res: ExpressResponse<{
      text: string;
    }>
  ) => {
    try {
      const { port, sandbox_id } = req.body;
      await dockerService.serveWebsiteAtPort(sandbox_id, port);
      res.json({
        text: `Successfully served website at port ${port} please repeat this sentence to user again: Please visit your website at http://${sandbox_id}-${port}.runbox.ai`,
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({ text: `Error serving website at port: ${error}` });
    }
  }
);

async function createTerminal(sandboxId: string): Promise<Terminal> {
  console.log(`Creating terminal for ${sandboxId}`);
  const startTime = performance.now();
  await dockerService.ensureContainerRunning(sandboxId);
  const endTime = performance.now();
  console.log(`ensureContainerRunning took ${(endTime - startTime) / 1000}s`);

  const startTime2 = performance.now();
  // Directly run the container bash as the main process
  const ptyProcess = pty.spawn(
    "docker",
    ["exec", "-it", sandboxId, "/bin/bash"],
    {
      name: "xterm-color",
      cols: 80,
      rows: 30,
      cwd: process.env.HOME,
      env: process.env,
    }
  );
  const newTerminal: Terminal = {
    id: nanoid(),
    pty: ptyProcess,
    status: "initializing",
    createdAt: Date.now(),
  };
  terminalMap[sandboxId] = terminalMap[sandboxId] || [];
  terminalMap[sandboxId].push(newTerminal);
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
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  const endTime2 = performance.now();
  console.log(`Terminal created took ${(endTime2 - startTime2) / 1000}s`);
  return newTerminal;
}

const getSandboxEditorUrlSchema = z.object({
  sandbox_id: z.string().min(1, "Sandbox ID is required"),
});

const fileService = new FileService();
app.post(
  "/api/tools/get_sandbox_editor_url",
  validateSchema(getSandboxEditorUrlSchema),
  async (req: Request, res: ExpressResponse) => {
    const { sandbox_id } = req.body;
    const url = await dockerService.getContainerCodeServerUrl(sandbox_id);
    res.json({ url });
  }
);

const writeFileSchema = z.object({
  path: z.string().min(1, "File path is required"),
  content: z.string(),
  sandbox_id: z.string(),
});
app.post(
  "/api/tools/write_file",
  validateSchema(writeFileSchema),
  async (
    req: Request<{}, {}, z.infer<typeof writeFileSchema>>,
    res: ExpressResponse<{
      text?: string;
      new_sandbox_id?: string;
      error?: string;
    }>
  ) => {
    // Body is now validated and typed
    try {
      let { path, content, sandbox_id } = req.body;
      let new_sandbox_created = false;
      let serverName: string | undefined;
      if (!sandbox_id) {
        const { sandboxId: newSandboxId, serverName: newServerName } =
          await dockerService.createContainer();
        sandbox_id = newSandboxId;
        new_sandbox_created = true;
        serverName = newServerName;
      }
      await fileService.writeFile(sandbox_id, path, content);
      res.json({
        text: `Write success. File can be viewed at http://${sandbox_id}.runbox.ai`,
        // (!!serverName
        //   ? ` and inform user to go to http://${serverName}.runbox.ai/?folder=/home to view their sandbox files.`
        //   : ""),
        new_sandbox_id: new_sandbox_created ? sandbox_id : undefined,
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: `Error writing file: ${error}` });
    }
  }
);

const readFileSchema = z.object({
  path: z.string().min(1, "File path is required"),
  sandbox_id: z.string().min(1, "Sandbox ID is required"),
});

app.post(
  "/api/tools/read_file",
  validateSchema(readFileSchema),
  async (req: Request, res: ExpressResponse) => {
    // Body is now validated and typed
    const { path, sandbox_id } = req.body;
    try {
      const content = await fileService.readFile(sandbox_id, path);
      res.json({ text: content });
    } catch (error) {
      console.error(`Error reading file: ${error}`);
      res.status(500).json({ error: `Error reading file: ${error}` });
    }
  }
);

const listDirectorySchema = z.object({
  path: z.string().min(1, "File path is required"),
  sandbox_id: z.string().min(1, "Sandbox ID is required"),
});
app.post(
  "/api/tools/list_directory",
  validateSchema(listDirectorySchema),
  async (req: Request, res: ExpressResponse) => {
    // Body is now validated and typed
    const { path, sandbox_id } = req.body;
    try {
      const content = await fileService.listDirectory(sandbox_id, path);
      res.json({ text: JSON.stringify(content, null, 2) });
    } catch (error) {
      console.error(`Error listing directory: ${error}`);
      res.status(500).json({ error: `Error listing directory: ${error}` });
    }
  }
);

const executeCommandSchema = z.object({
  command: z.string().min(1, "Command is required"),
  sandbox_id: z.string().min(1, "Sandbox ID is required"),
  timeout: z.number().optional(),
});

//curl http://localhost:8888/api/tools/execute_command -X POST -H "Content-Type: application/json" -d '{"command": "node --version", "sandbox_id": "3uY1l5Y0eH3", "timeout": 1000}'
app.post(
  "/api/tools/execute_command",
  validateSchema(executeCommandSchema),
  async (
    req: Request<{}, {}, z.infer<typeof executeCommandSchema>>,
    res: ExpressResponse
  ) => {
    let {
      command,
      sandbox_id,
      timeout = 10 * 1000, // timeout after command running for 10s
    } = req.body;

    let terminal = terminalMap[sandbox_id]?.find((t) => t.status === "ready");
    if (!terminal) {
      try {
        terminal = await createTerminal(sandbox_id);
      } catch (error) {
        console.error(`Error creating terminal: ${error}`);
        return res
          .status(500)
          .json({ error: `Error creating terminal: ${error}` });
      }
    }
    const ptyProcess = terminal.pty;
    // res.setHeader("Content-Type", "text/plain");
    // res.setHeader("Transfer-Encoding", "chunked");

    // const sentinel = `__END_${id}__`;
    const sentinel = `__END_SIG_${nanoid(2)}__`;
    const escapedCommand = command.replace(/'/g, `'\\''`);
    if (command.endsWith("&")) {
      command = command.slice(0, -1);
    }
    if (command.endsWith(";")) {
      command = command.slice(0, -1);
    }
    const wrapped = `sh -c '${escapedCommand}; echo ${sentinel}'`;

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

    // Handle client disconnect
    // req.on("close", () => {
    //   setTimeout(() => {
    //     listener.dispose();
    //   }, 2000);
    // });
  }
);

function killTerminal(sandboxId: string, terminalId: string) {
  const terminal = terminalMap[sandboxId]?.find((t) => t.id === terminalId);
  if (terminal) {
    terminalMap[sandboxId] = terminalMap[sandboxId]?.filter(
      (t) => t.id !== terminalId
    );
    terminal.pty.kill();
    console.log(`Terminal ${terminalId} killed for ${sandboxId}`);
  }
}

import { LRUCache } from "lru-cache";

const staticCache = new LRUCache<string, express.Handler>({
  max: 5000, // Keep up to 5 000 sandbox middlewares in memory.
  // how long to live in ms
  ttl: 1000 * 60 * 30, // 30 min of inactivity
  allowStale: false, // don’t serve stale entries
});
const VALID_ID = /^[A-Za-z0-9_-]+$/; // only allow alphanumeric, underscore, and dash

app.use("/site/:sandboxId", async (req, res, next) => {
  const { sandboxId } = req.params as { sandboxId: string };
  console.log(`[${sandboxId}] Request for static file`);
  if (!VALID_ID.test(sandboxId)) {
    return res.status(400).send("Invalid Sandbox ID");
  }

  try {
    // Resolve & validate workspace path
    const rootDir = getContainerWorkspacePath(sandboxId);
    await fs.access(path.join(rootDir, "index.html")); // 404 if it doesn’t exist

    // Look up (or create) cached middleware
    let handler = staticCache.get(sandboxId);
    if (!handler) {
      handler = express.static(rootDir, {
        index: "index.html",
        extensions: ["html"],
        fallthrough: false,
        immutable: true,
        maxAge: "1h",
      });
      staticCache.set(sandboxId, handler);
    }

    return handler(req, res, next);
  } catch {
    return res.status(404).send("Sandbox does not exist");
  }
});

app.use((err: any, req: Request, res: ExpressResponse, next: NextFunction) => {
  console.error("Caught error:", err);
  res.status(500).send(`Something went wrong: ${err}`);
});

// Start server
app
  .listen(port, () => {
    console.log(`Server is running on port ${port}`);
  })
  .on("error", (err: NodeJS.ErrnoException) => {
    console.error(err);
    if (err.code === "EACCES") {
      console.error(
        `Port ${port} requires elevated privileges. Please run with sudo or use a port above 1024.`
      );
      process.exit(1);
    }
  });
