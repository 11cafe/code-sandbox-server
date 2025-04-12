import express, { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { DockerService } from './docker-service';

const app = express();
const port = 8080;

// Middleware
app.use(express.json());

// Validation middleware
const validateSchema = <T extends z.ZodType>(schema: T) => {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);
    
    if (!result.success) {
      return res.status(400).json({
        error: 'Invalid request parameters',
        details: result.error.format()
      });
    }
    
    // Add the validated and typed data to the request
    req.body = result.data;
    next();
  };
};
const validateAuth = (req: Request, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  if (authHeader !== process.env.API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
};

// Routes
app.get('/', (req: Request, res: Response) => {
  res.json({ message: 'Welcome to the Express TypeScript server!' });
});

const dockerService = new DockerService();

// Define schemas for API endpoints
const createSandboxSchema = z.object({
  with_file_path: z.string().optional(),
  with_file_content: z.string().optional()
});

app.post('/api/tools/create_sandbox', 
  validateSchema(createSandboxSchema),
  validateAuth,
  async (req: Request<{},{}, z.infer<typeof createSandboxSchema>>, res: Response) => {
    const sandboxId = await dockerService.createContainer();

    res.json({ id: sandboxId });
  }
);

const writeFileSchema = z.object({
  path: z.string(),
  content: z.string(),
  sandbox_id: z.string().min(1, "Sandbox ID is required")
});

app.post('/api/tools/write_file', 
  validateSchema(writeFileSchema),
  (req: Request, res: Response) => {
    // Body is now validated and typed
    const { path, content, sandbox_id } = req.body;
    res.json({ message: 'Welcome to the Express TypeScript server!' });
  }
);

const readFileSchema = z.object({
  path: z.string().min(1, "File path is required"),
  sandbox_id: z.string().min(1, "Sandbox ID is required")
});

app.post('/api/tools/read_file',
  validateSchema(readFileSchema),
  (req: Request, res: Response) => {
    // Body is now validated and typed
    const { path, sandbox_id } = req.body;
    res.json({ message: 'Welcome to the Express TypeScript server!' });
  }
);

// Start server
app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
}).on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EACCES') {
    console.error(`Port ${port} requires elevated privileges. Please run with sudo or use a port above 1024.`);
    process.exit(1);
  }
}); 