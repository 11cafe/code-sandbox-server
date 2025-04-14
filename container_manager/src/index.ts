import express, {
  Request,
  Response as ExpressResponse,
  NextFunction,
} from "express";
import { z } from "zod";
import { DockerService } from "./docker-service";
import * as pty from "node-pty";
import { nanoid } from "nanoid";

const app = express();
const port = 8888;

// Middleware
app.use(express.json());

// Validation middleware
const validateSchema = <T extends z.ZodType>(schema: T) => {
  return (req: Request, res: ExpressResponse, next: NextFunction) => {
    const result = schema.safeParse(req.body);

    if (!result.success) {
      return res.status(400).json({
        error: "Invalid request parameters",
        details: result.error.format(),
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
  const terminalId = nanoid();
  const newTerminal: Terminal = {
    id: terminalId,
    pty: ptyProcess,
    status: "initializing",
    createdAt: Date.now(),
  };
  terminalMap[sandboxId] = terminalMap[sandboxId] || [];
  terminalMap[sandboxId].push(newTerminal);
  // Pipe terminal output to stdout
  ptyProcess.onData((data) => {
    process.stdout.write(data);
  });

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

  return newTerminal;
}

const writeFileSchema = z.object({
  path: z.string(),
  content: z.string(),
  sandbox_id: z.string().min(1, "Sandbox ID is required"),
});

app.post(
  "/api/tools/write_file",
  validateSchema(writeFileSchema),
  (req: Request, res: ExpressResponse) => {
    // Body is now validated and typed
    const { path, content, sandbox_id } = req.body;
    res.json({ message: "Welcome to container manager!" });
  }
);

const readFileSchema = z.object({
  path: z.string().min(1, "File path is required"),
  sandbox_id: z.string().min(1, "Sandbox ID is required"),
});

app.post(
  "/api/tools/read_file",
  validateSchema(readFileSchema),
  (req: Request, res: ExpressResponse) => {
    // Body is now validated and typed
    const { path, sandbox_id } = req.body;
    res.json({ message: "Welcome to the Express TypeScript server!" });
  }
);

const executeCommandSchema = z.object({
  command: z.string().min(1, "Command is required"),
  sandbox_id: z.string().min(1, "Sandbox ID is required"),
  timeout: z.number().optional(),
});

//curl http://localhost:8888/api/tools/execute_command -X POST -H "Content-Type: application/json" -d '{"command": "node --version", "sandbox_id": "3uY19TEg8oAaHcl5Y0eH3", "timeout": 1000}'
app.post(
  "/api/tools/execute_command",
  validateSchema(executeCommandSchema),
  async (
    req: Request<{}, {}, z.infer<typeof executeCommandSchema>>,
    res: ExpressResponse
  ) => {
    const { command, sandbox_id, timeout } = req.body;
    let terminal = terminalMap[sandbox_id]?.find((t) => t.status === "ready");
    if (!terminal) {
      terminal = await createTerminal(sandbox_id);
    }
    const ptyProcess = terminal.pty;
    res.setHeader("Content-Type", "text/plain");
    res.setHeader("Transfer-Encoding", "chunked");
    res.write("Waiting for command to finish...\n");

    const id = Date.now(); // or generate UUID
    const sentinel = `__END_${id}__`;
    const wrapped = `sh -c "${command}; echo ${sentinel}"`;

    let buffer = "";
    // because the SENTINEL would appear twice, first time when command invoked, should be ignored
    let firstSentinelDone = false;
    terminal.status = "running";
    const listener = ptyProcess.onData((data) => {
      res.write(data);
      buffer += data;
      if (buffer.includes(sentinel)) {
        if (!firstSentinelDone) {
          // first sentinel, command started
          firstSentinelDone = true;
        } else {
          // second sentinel, command finished
          res.end();
          listener.dispose();
          buffer = "";
          setTimeout(() => {
            terminal.status = "ready";
          }, 200);
        }
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
