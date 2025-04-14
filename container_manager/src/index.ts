import express, {
  Request,
  Response as ExpressResponse,
  NextFunction,
} from "express";
import { z } from "zod";
import { DockerService } from "./docker-service";
import * as pty from "node-pty";

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

let ptyProcess: pty.IPty;

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
    createTerminal(sandboxId);
    res.json({ id: sandboxId });
  }
);

function createTerminal(sandboxId: string) {
  const shell = "bash";

  ptyProcess = pty.spawn(shell, [], {
    name: "xterm-color",
    cols: 80,
    rows: 30,
    cwd: process.env.HOME,
    env: process.env,
  });

  // Pipe output to the real terminal
  ptyProcess.onData((data) => {
    process.stdout.write(data);
  });

  let buffer = "";
  let inContainerShell = false;
  const cleanup = ptyProcess.onData((data) => {
    buffer += data;

    if (buffer.includes("$ ") || buffer.includes("# ")) {
      // Shell is ready — send the command
      if (!inContainerShell) {
        ptyProcess.write(`sudo docker exec -it ${sandboxId} /bin/bash\r`);
        buffer = ""; // reset if needed
        inContainerShell = true;
      } else {
        ptyProcess.write("ls / \r");
        cleanup.dispose();
      }
    }
  });
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

    res.setHeader("Content-Type", "text/plain");
    res.setHeader("Transfer-Encoding", "chunked");
    res.write("Hello, waiting for command to finish...\n");
    // Create a listener for the pty output

    // Attach the listener
    const listener = ptyProcess.onData((data) => {
      console.log("stream data", data);
      res.write(data);
    });

    // Write the command
    setTimeout(() => {
      ptyProcess.write(`${command}\r`);
    }, 1000);
    setTimeout(() => {
      res.end();
    }, 5000);
    // Handle client disconnect
    // req.on("close", () => {
    //   listener.dispose();
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
