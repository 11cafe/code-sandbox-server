import { exec } from "child_process";
import { promisify } from "util";
import * as fs from "fs/promises";
import * as path from "path";
import { nanoid } from "nanoid";
import dotenv from "dotenv";
import { Readable } from "stream";
import { Dirent } from "fs";

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
  private static readonly PORT_RANGE_START = 2001;
  private static readonly PORT_RANGE_END = 65535;
  usedPorts: PortMapping = {}; // containerId -> port

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

export class DockerService {
  private static BASE_IMAGE = process.env.BASE_IMAGE;
  portManager = new PortManager();

  constructor() {
    if (!DockerService.BASE_IMAGE) {
      throw new Error("BASE_IMAGE is not set");
    }
  }

  async ensureContainerRunning(containerId: string) {
    // sudo docker container inspect -f '{{.State.Running}}' <container_name> => true
    try {
      const { stdout } = await execAsync(
        `docker container inspect -f '{{.State.Running}}' ${containerId}`
      );

      const running = stdout.trim() === "true";
      console.log(`Container ${containerId} is running: ${running}`);

      if (!running) {
        console.log(`Container ${containerId} is not running, resuming...`);
        await this.resumeContainer(containerId);
        console.log(`Container ${containerId} resumed`);
      }
    } catch (error) {
      console.error(`Error checking container ${containerId}: ${error}`);
      await this.createContainer(containerId);
    }
  }

  async stopContainer(sandboxId: string) {
    // Release the port when container is removed
    this.portManager.releasePort(sandboxId);
    // ... existing container removal code ...
  }
  async resumeContainer(sandboxId: string) {
    // Resume the container
    await execAsync(`sudo docker start ${sandboxId}`);
  }

  private async getContainerIP(containerId: string): Promise<string> {
    try {
      const { stdout } = await execAsync(
        `docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' ${containerId}`
      );
      return stdout.trim();
    } catch (error) {
      throw new Error(`Failed to get container IP: ${error}`);
    }
  }

  private async updateNginxConfig(
    containerId: string,
    containerIP: string
  ): Promise<void> {
    try {
      await execAsync(
        `docker exec nginx-proxy /usr/local/bin/update-nginx.sh 
        ${containerId} ${containerIP} ${nanoid(14)}`
      );
    } catch (error) {
      throw new Error(`Failed to update nginx config: ${error}`);
    }
  }

  async createContainer(existingSandboxId?: string): Promise<string> {
    const startTime = performance.now();
    const sandboxId = existingSandboxId || nanoid();
    console.log(`Creating container ${sandboxId}`);

    const hostWorkspacePath = getContainerWorkspacePath(sandboxId);
    // Create workspace directory on host
    await fs.mkdir(hostWorkspacePath, { recursive: true });
    await execAsync(`docker network create ${sandboxId}-network`);
    // Create workspace directory on host
    await execAsync(
      `docker run -d \
        --name ${sandboxId} \
        -v ${hostWorkspacePath}:${CONTAINER_WORKING_DIR} \
        -w ${CONTAINER_WORKING_DIR} \
        ${DockerService.BASE_IMAGE}`
    );

    // Get container IP and update nginx config
    const containerIP = await this.getContainerIP(sandboxId);
    await this.updateNginxConfig(sandboxId, containerIP);

    console.log(
      `🗂️Container ${sandboxId} created in ${
        (performance.now() - startTime) / 1000
      }s`
    );
    return sandboxId;
  }
}

export class FileService {
  getContainerFilePath(containerId: string, filePath: string): string {
    if (filePath.startsWith("/")) {
      filePath = filePath.slice(1);
    }
    return `${getContainerWorkspacePath(containerId)}/${filePath}`;
  }

  async writeFile(
    containerId: string,
    filePath: string,
    content: string
  ): Promise<void> {
    // always use relative path
    const fullPath = this.getContainerFilePath(containerId, filePath);

    // Create directory structure if needed
    await fs.mkdir(path.dirname(fullPath), { recursive: true });

    // Write file directly to host filesystem
    await fs.writeFile(fullPath, content, "utf-8");
  }

  async readFile(containerId: string, filePath: string): Promise<string> {
    const fullPath = this.getContainerFilePath(containerId, filePath);

    return await fs.readFile(fullPath, "utf-8");
  }

  async listDirectory(
    containerId: string,
    dirPath: string
  ): Promise<
    {
      name: string;
      type: "file" | "dir";
    }[]
  > {
    const fullPath = this.getContainerFilePath(containerId, dirPath);

    try {
      const files = await fs.readdir(fullPath, { withFileTypes: true });
      return files.map((file) => ({
        name: file.name,
        type: file.isFile() ? "file" : "dir",
      }));
    } catch (error) {
      throw new Error(`Failed to list directory: ${error}`);
    }
  }
}
