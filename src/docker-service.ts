import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import * as path from 'path';
import { nanoid } from 'nanoid';

const execAsync = promisify(exec);
const HOST_WORKSPACE_ROOT = '/data/workspaces';
const CONTAINER_WORKING_DIR = '/home/workspace';

function getContainerWorkspacePath(containerId: string): string {
  return path.join(HOST_WORKSPACE_ROOT, containerId);
}


export class DockerService {
  private static BASE_IMAGE = 'ubuntu:22.04';

  private async ensureContainerExists(containerId: string): Promise<boolean> {
    try {
      const { stdout } = await execAsync(`docker ps -a --filter "id=${containerId}" --format "{{.ID}}"`);
      return !!stdout.trim();
    } catch (error) {
      return false;
    }
  }

  async createContainer(): Promise<string> {
    const sandboxId = nanoid();
    try {
      const hostWorkspacePath = getContainerWorkspacePath(sandboxId);
      
      // Create workspace directory on host
      await fs.mkdir(hostWorkspacePath, { recursive: true });

      // Create workspace directory on host
      await execAsync(
        `docker run -d \
         --name ${sandboxId} \
         -v ${hostWorkspacePath}:${CONTAINER_WORKING_DIR} \
         -w ${CONTAINER_WORKING_DIR} \
         ${DockerService.BASE_IMAGE} \
         tail -f /dev/null`  // Keep container running
      );

      // Set up the container with necessary packages
    //   await execAsync(`docker exec ${sandboxId} bash -c "\
    //     apt-get update && \
    //     apt-get install -y \
    //       python3 \
    //   "`);
      return sandboxId;
    } catch (error) {
      throw new Error(`Failed to create container: ${error}`);
    }
  }

  async executeCommand(containerId: string, command: string): Promise<string> {
    const exists = await this.ensureContainerExists(containerId);
    if (!exists) {
      throw new Error('Container not found');
    }

    try {
      // Execute command in container's workspace directory
      const { stdout, stderr } = await execAsync(
        `docker exec -w /home/sandbox/workspace ${containerId} bash -c "${command.replace(/"/g, '\\"')}"`
      );
      return stdout || stderr;
    } catch (error) {
      throw new Error(`Command execution failed: ${error}`);
    }
  }
} 

export class FileService {
  async writeFile(containerId: string, filePath: string, content: string): Promise<void> {
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
      return await fs.readFile(fullPath, 'utf-8');
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