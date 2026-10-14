// 先等待本次启动的后端 health 就绪，再启动同源代理使用的 Vite。
import { spawn } from "node:child_process";
import net from "node:net";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HOST = "127.0.0.1";
const children = new Set();
let closing = false;

// 即使父进程被直接关闭，stdin 管道的 EOF 也会让两个子进程退出，避免遗留后台服务。
const stdinGuard = "data:text/javascript," + encodeURIComponent(
  'process.stdin.on("end", () => process.exit(0)); process.stdin.on("error", () => process.exit(1)); process.stdin.resume();'
);

async function shutdown(code = 0) {
  if (closing) return;
  closing = true;
  const exits = [...children].map((child) => new Promise((resolve) => {
    child.once("close", resolve);
    child.stdin.end();
    child.kill();
  }));
  const deadline = setTimeout(() => process.exit(code), 5000);
  await Promise.all(exits);
  clearTimeout(deadline);
  process.exit(code);
}

process.once("SIGINT", () => void shutdown(0));
process.once("SIGTERM", () => void shutdown(0));
process.once("disconnect", () => void shutdown(0));
process.stdin.once("end", () => void shutdown(0));
process.stdin.once("error", () => void shutdown(1));
process.stdin.resume();
process.once("exit", () => {
  for (const child of children) child.kill();
});

function assertFreePort(port) {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", (error) => reject(new Error(`端口 ${port} 不可用，拒绝连接已有服务：${error.message}`)));
    probe.listen({ host: HOST, port, exclusive: true }, () => probe.close((error) => error ? reject(error) : resolve()));
  });
}

function run(label, args, env = {}) {
  if (closing) throw new Error("启动器正在退出。");
  const child = spawn(process.execPath, ["--import", stdinGuard, ...args], {
    cwd: ROOT,
    stdio: ["pipe", "inherit", "inherit", "ipc"],
    env: { ...process.env, ...env },
  });
  children.add(child);
  child.stdin.on("error", () => {});
  child.once("close", (code, signal) => {
    children.delete(child);
    if (!closing) {
      console.error(`[${label}] 进程退出（${code ?? signal}），正在停止其余进程。`);
      void shutdown(code || 1);
    }
  });
  child.once("error", (error) => {
    console.error(`[${label}] 启动失败：${error.message}`);
    void shutdown(1);
  });
  return child;
}

async function waitForHealth(server) {
  let ownsPort = false;
  server.on("message", (message) => {
    if (message?.type === "whiteboard-listening" && message.port === 4173 && message.pid === server.pid) ownsPort = true;
  });
  const deadline = Date.now() + 30_000;
  while (!closing && server.exitCode === null && server.signalCode === null && Date.now() < deadline) {
    try {
      const response = await fetch(`http://${HOST}:4173/api/health`, { signal: AbortSignal.timeout(1000) });
      const health = response.ok ? await response.json() : null;
      if (ownsPort && health?.app === "whiteboard-local" && health.port === 4173 && typeof health.dataDir === "string") {
        if (!closing && server.exitCode === null && server.signalCode === null) return;
      }
    } catch {
      // 后端尚未监听时短暂轮询；不会退回连接其他端口或启动只带前端的环境。
    }
    await delay(100);
  }
  if (!closing) throw new Error("后端未在 30 秒内通过 4173/api/health 检查，未启动 Vite。");
}

async function main() {
  await Promise.all([assertFreePort(4173), assertFreePort(5173)]);
  if (closing) return;
  // 在开发子进程内限定 listen，阻止服务器的生产模式自动换端口或复用既有实例。
  const backendEntry = `
    const { createLocalServer } = require(${JSON.stringify(path.join(ROOT, "server", "server.cjs"))});
    const app = createLocalServer({ port: 4173, noOpen: true });
    const listen = app.server.listen;
    app.server.listen = function (port, ...args) {
      if (port !== 4173) throw new Error("开发后端只能监听 4173，禁止换端口。");
      this.once("listening", () => process.send({ type: "whiteboard-listening", port: this.address().port, pid: process.pid }));
      return listen.call(this, port, ...args);
    };
    app.start().then((result) => {
      if (result.reused || result.port !== 4173) throw new Error("开发后端未独立监听 4173，禁止复用其他进程。");
    }).catch((error) => { console.error(error.message); process.exit(1); });
  `;
  const server = run("server", ["--input-type=commonjs", "-e", backendEntry], { PORT: "4173" });
  await waitForHealth(server);
  if (closing) return;
  run("vite", [path.join(ROOT, "node_modules", "vite", "bin", "vite.js"),
    "--host", HOST, "--port", "5173", "--strictPort",
  ], { BROWSER: "none" });
  console.log("后端 health 已就绪；正在启动 Vite :5173，后端固定 :4173。");
}

main().catch((error) => {
  if (!closing) {
    console.error(error.message);
    void shutdown(1);
  }
});
