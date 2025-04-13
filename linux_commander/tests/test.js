const express = require("express");
const { spawn } = require("child_process");
const { Server } = require("http");
const {
  describe,
  test,
  expect,
  beforeAll,
  afterAll,
} = require("@jest/globals");

describe("Linux Commander E2E Tests", () => {
  let server;
  let app;
  const PORT = 3456; // Using a different port for testing

  beforeAll(async () => {
    // Import the express app but prevent it from auto-starting
    const originalListen = Server.prototype.listen;
    Server.prototype.listen = function () {
      return this;
    };

    // Import your app
    app = require("../index.ts");

    // Restore original listen
    Server.prototype.listen = originalListen;

    // Start server on test port
    // server = app.listen(PORT);
  });

  afterAll(async () => {
    // Cleanup: close the server
    // await new Promise((resolve) => server.close(resolve));
  });

  test("basic command execution", async () => {
    const response = await fetch(`http://localhost:${PORT}/api/command`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ command: 'echo "Hello World"' }),
    });

    const data = await response.text();
    expect(data).toContain("Hello World");
  });

  test("error on invalid command", async () => {
    const response = await fetch(`http://localhost:${PORT}/api/command`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ command: null }),
    });

    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toBe("Invalid command");
  });

  test("interactive command behavior", async () => {
    const response = await fetch(`http://localhost:${PORT}/api/command`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ command: 'read -p "Enter name: " name' }),
    });

    // We expect the command to either timeout or return an error
    // since it's interactive and we can't provide input
    const data = await response.text();
    expect(data).toBeTruthy(); // Just checking we get some response
  });

  test("command with environment variables", async () => {
    const response = await fetch(`http://localhost:${PORT}/api/command`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ command: "echo $PATH" }),
    });

    const data = await response.text();
    expect(data).toContain("/"); // PATH should contain at least one slash
  });

  test("API key authentication", async () => {
    // Test without API key when one is required
    process.env.API_KEY = "test-key";

    const response = await fetch(`http://localhost:${PORT}/api/command`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ command: 'echo "test"' }),
    });

    expect(response.status).toBe(401);

    // Clean up
    delete process.env.API_KEY;
  });

  test("long-running command", async () => {
    const response = await fetch(`http://localhost:${PORT}/api/command`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ command: 'sleep 1 && echo "Done"' }),
    });

    const data = await response.text();
    expect(data).toContain("Done");
  }, 3000); // Timeout after 3 seconds
});
