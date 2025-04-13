import express, {
  Request,
  Response as ExpressResponse,
  NextFunction,
} from "express";
import { z } from "zod";
import { DockerService } from "./docker-service";

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
app.post(
  "/api/tools/execute_command",
  validateSchema(executeCommandSchema),
  async (
    req: Request<{}, {}, z.infer<typeof executeCommandSchema>>,
    res: ExpressResponse
  ) => {
    const { command, sandbox_id, timeout } = req.body;

    const port = dockerService.portManager.getPort(sandbox_id);
    if (!port) {
      res.status(404).json({ error: "Sandbox not found" });
      return;
    }

    async function tryExecuteCommand(port: number): Promise<Response> {
      const response = await fetch(`http://localhost:${port}/execute_command`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ command, timeout }),
      });

      return response;
    }

    // First attempt to get stream
    let response = await tryExecuteCommand(port);
    if (!response.ok) {
      // cannot reach to commander server, try to resume container
      try {
        await dockerService.resumeContainer(sandbox_id);
      } catch (error) {
        res.status(500).json({ error: "Failed to resume container" });
        return;
      }
      // retry
      response = await tryExecuteCommand(port);
      if (!response.ok) {
        res.status(500).json({ error: "Failed to connect to container" });
        return;
      }
    }

    // Set appropriate headers for streaming
    res.setHeader("Content-Type", "text/plain");
    res.setHeader("Transfer-Encoding", "chunked");

    // Get the readable stream from the response
    const reader = response.body?.getReader();
    if (!reader) {
      res.status(500).json({ error: "Failed to get reader to stream" });
      return;
    }

    // Read the stream chunks and forward them to the client
    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      // Forward the chunk to the client
      res.write(value);
    }

    res.end();
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
