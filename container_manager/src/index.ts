import express, {
  Request,
  Response as ExpressResponse,
  NextFunction,
} from "express";
import { z } from "zod";
import { DockerService, FileService } from "./docker-service";
import * as pty from "node-pty";
import { nanoid } from "nanoid";
import stripAnsi from "strip-ansi";

const app = express();
const port = process.env.PORT || 8888;

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

// Define schemas for API endpoints
const createSandboxSchema = z.object({
  with_file_path: z.string().optional(),
  with_file_content: z.string().optional(),
});

type Terminal = {
  id: string;
  pty: pty.IPty;
  status: "initializing" | "ready" | "running";
  createdAt: number;
};
let terminalMap: {
  [key: string]: Terminal[];
} = {};

// sudo netstat -tulpn | grep :8888
// curl http://localhost:8888/api/tools/create_sandbox -X POST -H "Content-Type: application/json" -d '{}'
app.post(
  "/api/tools/create_sandbox",
  validateSchema(createSandboxSchema),
  // validateAuth,
  async (
    req: Request<{}, {}, z.infer<typeof createSandboxSchema>>,
    res: ExpressResponse
  ) => {
    const sandboxId = await dockerService.createContainer();
    res.json({ id: sandboxId });
  }
);

async function createTerminal(sandboxId: string): Promise<Terminal> {
  console.log(`Creating terminal for ${sandboxId}`);
  await dockerService.ensureContainerRunning(sandboxId);

  // Directly run the container bash as the main process
  const ptyProcess = pty.spawn(
    "sudo",
    ["docker", "exec", "-it", sandboxId, "/bin/bash"],
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
  console.log(`Terminal ${newTerminal.id} created for ${sandboxId}`);
  return newTerminal;
}

const writeFileSchema = z.object({
  path: z.string().min(1, "File path is required"),
  content: z.string(),
  sandbox_id: z.string().optional(),
});

const fileService = new FileService();

app.post(
  "/api/tools/write_file",
  validateSchema(writeFileSchema),
  async (
    req: Request<{}, {}, z.infer<typeof writeFileSchema>>,
    res: ExpressResponse
  ) => {
    // Body is now validated and typed
    try {
      let { path, content, sandbox_id } = req.body;
      if (!sandbox_id) {
        sandbox_id = await dockerService.createContainer();
      }
      await fileService.writeFile(sandbox_id, path, content);
      res.json({
        text: `${path} written successfully to sandbox_id ${sandbox_id}`,
      });
    } catch (error) {
      console.error(`Error writing file: ${error}`);
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
    const {
      command,
      sandbox_id,
      timeout = 15 * 1000, // timeout after command running for 15s
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
    const wrapped = `sh -c '${escapedCommand}; echo ${sentinel}'`;

    let buffer = "";
    // because the SENTINEL would appear twice, first time when command invoked, should be ignored
    terminal.status = "running";
    const timeoutId = setTimeout(() => {
      if (terminal.status === "running") {
        res.json({
          status: "unfinished",
          text: stripAnsi(buffer),
          terminal_id: terminal.id,
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
