import { exec } from "child_process";
import { promisify } from "util";
import * as fs from "fs/promises";
import * as path from "path";
import { nanoid } from "nanoid";
import dotenv from "dotenv";
import { Readable } from "stream";

dotenv.config();

const execAsync = promisify(exec);
const HOST_WORKSPACE_ROOT = "/data/workspaces";
const CONTAINER_WORKING_DIR = "/home";

function getContainerWorkspacePath(containerId: string): string {
  return path.join(HOST_WORKSPACE_ROOT, containerId);
}

interface PortMapping {
  [containerId: string]: number;
}

class PortManager {
  private static readonly PORT_RANGE_START = 3001;
  private static readonly PORT_RANGE_END = 9999;
  private usedPorts: PortMapping = {};

  private async isPortAvailable(port: number): Promise<boolean> {
    try {
      // Use netstat to check if port is in use
      await execAsync(`netstat -tuln | grep LISTEN | grep :${port}`);
      return false; // port is in use
    } catch (error) {
      // If command fails (grep finds nothing), port is available
      return true;
    }
  }

  async allocatePort(containerId: string): Promise<number> {
    let port = PortManager.PORT_RANGE_START;
    while (port <= PortManager.PORT_RANGE_END) {
      // Check if port is used in our mapping
      if (!Object.values(this.usedPorts).includes(port)) {
        // Check if port is available in system
        const isAvailable = await this.isPortAvailable(port);
        if (isAvailable) {
          this.usedPorts[containerId] = port;
          return port;
        }
      }
      port++;
    }
    throw new Error("No available ports");
  }

  getPort(containerId: string): number | undefined {
    return this.usedPorts[containerId];
  }

  releasePort(containerId: string): void {
    delete this.usedPorts[containerId];
  }
}

const portManager = new PortManager();

export class DockerService {
  private static BASE_IMAGE = process.env.BASE_IMAGE;

  constructor() {
    if (!DockerService.BASE_IMAGE) {
      throw new Error("BASE_IMAGE is not set");
    }
  }

  private async ensureContainerExists(containerId: string): Promise<boolean> {
    // sudo docker container inspect -f '{{.State.Running}}' <container_name> => true
    try {
      const { stdout } = await execAsync(
        `sudo docker ps -a --filter "id=${containerId}" --format "{{.ID}}"`
      );
      return !!stdout.trim();
    } catch (error) {
      return false;
    }
  }

  async stopContainer(sandboxId: string) {
    // Release the port when container is removed
    portManager.releasePort(sandboxId);
    // ... existing container removal code ...
  }
  async resumeContainer(sandboxId: string) {
    // Resume the container
    await execAsync(`sudo docker start ${sandboxId}`);
  }
  async createContainer(): Promise<string> {
    const sandboxId = nanoid();

    const hostWorkspacePath = getContainerWorkspacePath(sandboxId);
    // Create workspace directory on host
    await fs.mkdir(hostWorkspacePath, { recursive: true });
    const assignedPort = await portManager.allocatePort(sandboxId);

    // Create workspace directory on host
    await execAsync(
      `sudo docker run -d \
        --name ${sandboxId} \
        -v ${hostWorkspacePath}:${CONTAINER_WORKING_DIR} \
        -w ${CONTAINER_WORKING_DIR} \
        -e PORT=${assignedPort} \
        -p ${assignedPort}:${assignedPort} \
        ${DockerService.BASE_IMAGE}`
    );

    console.log(`🗂️Container ${sandboxId} created`);
    return sandboxId;
  }

  // async executeCommand(
  //   containerId: string,
  //   command: string
  // ): Promise<Readable> {
  //   const port = portManager.getPort(containerId);
  //   if (!port) {
  //     await this.resumeContainer(containerId);
  //   }

  //   async function tryFetchStream(port: number): Promise<Response> {
  //     const response = await fetch(`http://localhost:${port}/execute`, {
  //       method: "POST",
  //       headers: {
  //         "Content-Type": "application/json",
  //       },
  //       body: JSON.stringify({ command }),
  //     });

  //     if (!response.ok) {
  //       throw new Error(`Server responded with status: ${response.status}`);
  //     }

  //     return response;
  //   }

  //   try {
  //     // First attempt to get stream
  //     const response = await tryFetchStream(port);
  //     return Readable.from(response.body as ReadableStream);
  //   } catch (error) {
  //     // Server not responding, try to resume
  //     try {
  //       // Check container status
  //       await this.resumeContainer(containerId);

  //       // Try again after server restart
  //       const response = await tryFetchStream(port);
  //       return Readable.from(response.body);
  //     } catch (retryError) {
  //       // Create an error stream
  //       const errorStream = new Readable({
  //         read() {
  //           this.push(JSON.stringify({ error: retryError.message }));
  //           this.push(null);
  //         },
  //       });
  //       return errorStream;
  //     }
  //   }
  // }
}

export class FileService {
  async writeFile(
    containerId: string,
    filePath: string,
    content: string
  ): Promise<void> {
    const workspacePath = getContainerWorkspacePath(containerId);
    const fullPath = path.join(workspacePath, filePath);

    // Create directory structure if needed
    await fs.mkdir(path.dirname(fullPath), { recursive: true });

    // Write file directly to host filesystem
    await fs.writeFile(fullPath, content);
  }

  async readFile(containerId: string, filePath: string): Promise<string> {
    const workspacePath = getContainerWorkspacePath(containerId);
    const fullPath = path.join(workspacePath, filePath);

    try {
      return await fs.readFile(fullPath, "utf-8");
    } catch (error) {
      throw new Error(`Failed to read file: ${error}`);
    }
  }

  async listDirectory(containerId: string, dirPath: string): Promise<string[]> {
    const workspacePath = getContainerWorkspacePath(containerId);
    const fullPath = path.join(workspacePath, dirPath);

    try {
      const files = await fs.readdir(fullPath);
      return files;
    } catch (error) {
      throw new Error(`Failed to list directory: ${error}`);
    }
  }
}
