// The `node:http` binding, the file watcher, and the change stream.
//
// Everything interesting is in ./handler.ts and ./repository.ts; this is the part
// that has to touch sockets and inotify, kept small enough to read in one go.
//
// `node:http` rather than `Bun.serve` because the CLI's shebang is `node` — the
// package is installed with npm as often as with bun, and a dev command that only
// runs under one of them is a dev command half the users cannot use.

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { watch, type FSWatcher } from 'node:fs';
import { resolve } from 'node:path';
import { handleDevRequest, type DevContext } from './handler';

export interface DevServerOptions {
  /** Directory of documents to serve. */
  readonly dir: string;
  /** Where the package's `dist` lives, served to the browser as the runtime. */
  readonly runtimeDir: string;
  /** Bare-specifier dependencies of that runtime, as package name → directory. */
  readonly deps?: Readonly<Record<string, string>>;
  readonly port?: number;
  /**
   * Interface to bind.
   *
   * Loopback by default and deliberately: this server writes files the browser sends
   * it, so exposing it on a shared network would be handing out a filesystem.
   */
  readonly host?: string;
  /** Coalescing window for filesystem events, in milliseconds. */
  readonly debounceMs?: number;
  readonly onChange?: (paths: readonly string[]) => void;
}

export interface DevServer {
  readonly port: number;
  readonly host: string;
  readonly url: string;
  close(): Promise<void>;
}

const DEFAULT_DEBOUNCE_MS = 60;

/**
 * Collapse a burst of filesystem events into one notification.
 *
 * A single save is several events — editors write to a temp file and rename, some
 * write twice — and re-parsing the directory for each of them would make the page
 * flicker through intermediate states.
 */
export function createDebouncer(
  wait: number,
  flush: (paths: readonly string[]) => void,
): { push(path: string): void; cancel(): void } {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: string[] = [];

  return {
    push(path: string) {
      pending.push(path);
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        const batch = pending;
        pending = [];
        timer = null;
        flush(batch);
      }, wait);
      // Never let a pending redraw hold the process open.
      timer.unref?.();
    },
    cancel() {
      if (timer) clearTimeout(timer);
      timer = null;
      pending = [];
    },
  };
}

async function readBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  if (chunks.length === 0) return undefined;
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf-8'));
  } catch {
    return undefined;
  }
}

export async function startDevServer(options: DevServerOptions): Promise<DevServer> {
  const dir = resolve(options.dir);
  const context: DevContext = {
    dir,
    runtimeDir: resolve(options.runtimeDir),
    deps: options.deps,
    label: options.dir,
  };

  const streams = new Set<ServerResponse>();

  const server: Server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://localhost');

    if (url.pathname === '/api/events') {
      response.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-store',
        connection: 'keep-alive',
      });
      response.write('retry: 1000\n\n');
      streams.add(response);
      request.on('close', () => streams.delete(response));
      return;
    }

    void (async () => {
      const body =
        request.method === 'PUT' || request.method === 'POST' ? await readBody(request) : undefined;
      const result = await handleDevRequest(
        { method: request.method ?? 'GET', path: url.pathname, body },
        context,
      );
      response.writeHead(result.status, result.headers);
      response.end(result.body);
    })();
  });

  const debouncer = createDebouncer(options.debounceMs ?? DEFAULT_DEBOUNCE_MS, (paths) => {
    options.onChange?.(paths);
    const payload = `event: change\ndata: ${JSON.stringify({ paths })}\n\n`;
    for (const stream of streams) stream.write(payload);
  });

  let watcher: FSWatcher | null = null;
  try {
    watcher = watch(dir, { recursive: true }, (_event, filename) => {
      if (filename && !filename.toString().endsWith('.json')) return;
      debouncer.push(filename?.toString() ?? '');
    });
  } catch {
    // Recursive watching is unavailable on some platforms and older runtimes. The
    // server is still useful without it — the page reloads on demand — so this is a
    // degradation, not a failure.
    watcher = null;
  }

  const host = options.host ?? '127.0.0.1';
  const port = await new Promise<number>((resolvePort, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? 0, host, () => {
      const address = server.address();
      resolvePort(typeof address === 'object' && address ? address.port : 0);
    });
  });

  return {
    port,
    host,
    url: `http://${host}:${port}/`,
    async close() {
      debouncer.cancel();
      watcher?.close();
      for (const stream of streams) stream.end();
      streams.clear();
      await new Promise<void>((done) => server.close(() => done()));
    },
  };
}
