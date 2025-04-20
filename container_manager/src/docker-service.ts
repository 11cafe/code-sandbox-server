import { exec } from "child_process";
import { promisify } from "util";
import * as fs from "fs/promises";
import * as path from "path";
import { customAlphabet, nanoid } from "nanoid";
import dotenv from "dotenv";

dotenv.config();

const execAsync = promisify(exec);
const HOST_WORKSPACE_ROOT = "/data/workspaces";
const CONTAINER_WORKING_DIR = "/home";
const HOST_MACHINE_RUNBOX_ROOT = "/home/weixuan/runbox";

function getContainerWorkspacePath(containerId: string): string {
  return path.join(HOST_WORKSPACE_ROOT, containerId);
}
const runningContainers: Map<
  string,
  {
    createdAt: number;
    lastUsedAt: number;
  }
> = new Map();
const generateSandboxId = customAlphabet(
  "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789",
  21
);

export class DockerService {
  private static BASE_IMAGE = process.env.BASE_IMAGE || "runbox";
  // private static BASE_IMAGE = "runbox";

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
    // Stop container and remove network
    await execAsync(`sudo docker stop ${sandboxId}`);
    await execAsync(`docker network rm ${sandboxId}-network`).catch((err) => {
      // Ignore errors if network is already gone
      console.log(`Failed to remove network for ${sandboxId}: ${err}`);
    });
  }

  async resumeContainer(sandboxId: string) {
    const startTime = performance.now();
    // Recreate network
    try {
      // Check if network exists first it will crash resume by network with name ... already exists
      await execAsync(`docker network inspect ${sandboxId}-network`);
      console.log(`Network ${sandboxId}-network already exists`);
    } catch (error) {
      // Network doesn't exist, create it
      await execAsync(`docker network create ${sandboxId}-network`);
      console.log(`Created network ${sandboxId}-network`);
    }

    // Start container
    await execAsync(`docker start ${sandboxId}`);

    // Get new IP and update nginx
    const containerIP = await this.getContainerIP(sandboxId);
    await this.updateNginxConfig(sandboxId, containerIP, sandboxId);
    console.log(
      `Resumed container ${sandboxId} in ${
        (performance.now() - startTime) / 1000
      }s`
    );
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
    containerIP: string,
    serverName: string
  ): Promise<void> {
    await execAsync(
      `./update-nginx.sh ${containerId} ${containerIP} ${serverName}`
    );
  }

  private getNginxCodeServerConfigPath(sandboxId: string): string {
    return path.join(
      HOST_MACHINE_RUNBOX_ROOT,
      "nginx",
      "dynamics",
      `${sandboxId}.conf`
    );
  }

  async getContainerCodeServerUrl(sandboxId: string): Promise<string | null> {
    const configPath = this.getNginxCodeServerConfigPath(sandboxId);
    const config = await fs.readFile(configPath, "utf-8");
    const match = config.match(/server_name\s+([^;]+)/);
    return match ? match[1].trim() + ".runbox.ai/?folder=/home" : null;
  }

  async serveWebsiteAtPort(sandboxId: string, port: number) {
    try {
      const result = await execAsync(
        `docker exec ${sandboxId} sh -c "netstat -tln | grep -E '(0.0.0.0|127.0.0.1|::1|::):.?${port}'"`
      );

      if (!result) {
        throw new Error(
          `No http service found listening on port ${port}. Please make sure your web server is running and listening on ${port}`
        );
      }

      // Optional: Check if the port is bound to a proper address
      const isLocalOnly =
        result.stdout.includes("127.0.0.1:") || result.stdout.includes("::1:");
      if (isLocalOnly) {
        throw new Error(
          `Service on port ${port} is bound to localhost only. This might cause issues with external access.`
        );
      }
    } catch (error) {
      throw new Error(
        `No http service found running on port ${port}. Please make sure your web server is running and listening on ${port}`
      );
    }

    const containerIP = await this.getContainerIP(sandboxId);
    const dynamicNginxConfigPath = path.join(
      HOST_MACHINE_RUNBOX_ROOT,
      "nginx",
      "dynamics",
      `${sandboxId}-${port}.conf`
    );
    await fs.writeFile(
      dynamicNginxConfigPath,
      `server {
    listen 80;
    server_name ${sandboxId}-${port}.runbox.ai;

    location / {
        proxy_pass http://${containerIP}:${port}/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
`,
      "utf-8"
    );
    await execAsync(
      `sudo nginx -s reload -c ${HOST_MACHINE_RUNBOX_ROOT}/nginx.conf`
    );
  }

  async killOldestContainer(maxContainers: number = 3) {
    try {
      // Get all running containers with their creation time
      const { stdout } = await execAsync(
        `docker ps --format '{{.Names}}\t{{.CreatedAt}}' --filter "ancestor=${DockerService.BASE_IMAGE}"`
      );

      const containers = stdout
        .trim()
        .split("\n")
        .filter((line) => line) // Filter out empty lines
        .map((line) => {
          const [name, createdAt] = line.split("\t");
          return {
            name,
            createdAt: new Date(createdAt).getTime(),
            lastUsedAt: runningContainers.get(name)?.lastUsedAt ?? 0,
          };
        });
      console.log(
        "running containers",
        containers.map((c) => c.name + ": " + c.lastUsedAt)
      );

      // If we have more containers than the limit
      if (containers.length > maxContainers) {
        // Sort by creation time (oldest first)
        containers.sort((a, b) => a.lastUsedAt - b.lastUsedAt);

        // Get the oldest container
        const oldestContainer = containers[0];

        // Stop and remove the container
        await this.stopContainer(oldestContainer.name);

        console.log(`Killed oldest container ${oldestContainer.name}`);
        return oldestContainer.name;
      }

      return null; // Return null if no container needed to be killed
    } catch (error) {
      console.error("Error killing oldest container:", error);
      throw error;
    }
  }

  async createContainer(existingSandboxId?: string): Promise<{
    sandboxId: string;
    serverName: string;
  }> {
    const startTime = performance.now();
    const sandboxId = existingSandboxId || generateSandboxId(16);
    runningContainers.set(sandboxId, {
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
    });
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
        --network ${sandboxId}-network \
        -w ${CONTAINER_WORKING_DIR} \
        ${DockerService.BASE_IMAGE}`
    );
    // await new Promise((resolve) => setTimeout(resolve, 2000));
    // Get container IP and update nginx config
    const containerIP = await this.getContainerIP(sandboxId);
    console.log(`IP: ${containerIP} Container ${sandboxId}`);
    // const serverName = `sb-${sandboxId}-key-${nanoid(8)}`;
    const serverName = sandboxId;
    await this.updateNginxConfig(sandboxId, containerIP, serverName);

    console.log(
      `🗂️Container ${sandboxId} created in ${
        (performance.now() - startTime) / 1000
      }s`
    );
    console.log("Killing oldest container async");
    const startKilling = performance.now();
    this.killOldestContainer();
    console.log(
      `Killed oldest container in ${(performance.now() - startKilling) / 1000}s`
    );
    return { sandboxId, serverName };
  }
}
function updateLastUsedTime(containerId: string) {
  runningContainers.set(containerId, {
    createdAt: runningContainers.get(containerId)?.createdAt ?? Date.now(),
    lastUsedAt: Date.now(),
  });
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
    updateLastUsedTime(containerId);
    // always use relative path
    const fullPath = this.getContainerFilePath(containerId, filePath);

    // Create directory structure if needed
    await fs.mkdir(path.dirname(fullPath), { recursive: true });

    // Write file directly to host filesystem
    await fs.writeFile(fullPath, content, "utf-8");
    // Update last used time
  }

  async readFile(containerId: string, filePath: string): Promise<string> {
    updateLastUsedTime(containerId);
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
    updateLastUsedTime(containerId);
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
