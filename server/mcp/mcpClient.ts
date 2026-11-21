import crypto from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {
  McpIntegrationStatus,
  McpPermissionLevel,
} from '../../src/types/trading.ts';
import { formatNowIst } from '../quant/riskEngine.ts';
import {
  appendMcpAuditLog,
  getRecentMcpAuditLogs,
  getServerMcpBearerToken,
  getToolPermissionMatrix,
  isMcpAuthConfigured,
  MCP_PROTOCOL_VERSION,
  MCP_SERVER_NAME,
  MCP_SERVER_VERSION,
  MCP_TOOLS_CATALOG,
} from './mcpServer.ts';

class ArthQuantMcpClientManager {
  private client: Client | null = null;
  private transport: StreamableHTTPClientTransport | null = null;
  private connected = false;
  private lastConnectedIst: string | null = null;
  private lastToolInvocationIst: string | null = null;
  private lastError: string | null = null;
  private connectingPromise: Promise<Client> | null = null;
  private baseUrl: string | null = null;

  public setBaseUrl(url: string): void {
    this.baseUrl = url;
  }

  private getEndpointUrl(): URL {
    if (this.baseUrl) return new URL(this.baseUrl);
    const port = Number(process.env.PORT || 3000);
    return new URL(`http://127.0.0.1:${port}/mcp`);
  }

  public async disconnect(): Promise<void> {
    this.connected = false;
    try {
      await this.transport?.close();
    } catch {
      // ignore close errors
    }
    try {
      await this.client?.close();
    } catch {
      // ignore close errors
    }
    this.transport = null;
    this.client = null;
  }

  public async ensureConnected(): Promise<Client> {
    if (this.client && this.connected) {
      return this.client;
    }
    if (this.connectingPromise) {
      return this.connectingPromise;
    }

    this.connectingPromise = (async () => {
      await this.disconnect();
      const url = this.getEndpointUrl();
      const client = new Client({
        name: 'arthquant-ai-assistant-client',
        version: '1.0.0',
      });

      const transport = new StreamableHTTPClientTransport(url, {
        requestInit: {
          headers: {
            Authorization: `Bearer ${getServerMcpBearerToken()}`,
            'x-mcp-user': 'arthquant-copilot',
          },
        },
      });

      transport.onclose = () => {
        this.connected = false;
      };
      transport.onerror = (err) => {
        this.connected = false;
        this.lastError = err.message;
      };

      await client.connect(transport);
      this.client = client;
      this.transport = transport;
      this.connected = true;
      this.lastConnectedIst = formatNowIst();
      this.lastError = null;
      return client;
    })();

    try {
      return await this.connectingPromise;
    } catch (err) {
      this.connected = false;
      this.lastError = err instanceof Error ? err.message : String(err);
      throw err;
    } finally {
      this.connectingPromise = null;
    }
  }

  public async listTools(): Promise<{ name: string; description?: string }[]> {
    const client = await this.ensureConnected();
    const res = await client.listTools();
    return res.tools.map((t) => ({ name: t.name, description: t.description }));
  }

  public async callMcpToolForUser<T = unknown>(
    userId: string,
    allowedPermissions: McpPermissionLevel[],
    toolName: string,
    args: Record<string, unknown> = {}
  ): Promise<{
    data: T;
    durationMs: number;
    timestampIst: string;
    rawText: string;
  }> {
    const permMatrix = getToolPermissionMatrix();
    const requiredPerm = permMatrix[toolName];
    if (!requiredPerm) {
      throw new Error(`Unknown MCP tool '${toolName}'.`);
    }
    if (!allowedPermissions.includes(requiredPerm)) {
      appendMcpAuditLog({
        id: crypto.randomUUID().slice(0, 12),
        timestampIst: formatNowIst(),
        toolName,
        userId,
        permissionLevel: requiredPerm,
        status: 'DENIED',
        durationMs: 0,
        summary: `User '${userId}' lacks required permission '${requiredPerm}' for '${toolName}'.`,
      });
      throw new Error(`Permission denied: '${toolName}' requires '${requiredPerm}'.`);
    }

    const start = Date.now();
    let lastErr: unknown = null;

    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const client = await this.ensureConnected();
        const res = await client.callTool({
          name: toolName,
          arguments: args,
        });
        this.lastToolInvocationIst = formatNowIst();
        this.lastError = null;

        const textBlock = Array.isArray(res.content)
          ? res.content.find((c) => c.type === 'text' && typeof c.text === 'string')
          : undefined;
        const rawText = textBlock && 'text' in textBlock ? String(textBlock.text) : '{}';
        const parsed = JSON.parse(rawText);

        if (res.isError) {
          throw new Error(parsed?.error || `MCP tool '${toolName}' returned error.`);
        }

        return {
          data: parsed as T,
          durationMs: Date.now() - start,
          timestampIst: this.lastToolInvocationIst,
          rawText,
        };
      } catch (err) {
        lastErr = err;
        // Reconnect once if transport/connection dropped
        const msg = err instanceof Error ? err.message : String(err);
        if (attempt === 0 && (msg.includes('fetch') || msg.includes('ECONN') || msg.includes('closed'))) {
          await this.disconnect();
          continue;
        }
        break;
      }
    }

    const finalMsg = lastErr instanceof Error ? lastErr.message : String(lastErr);
    this.lastError = finalMsg;
    throw new Error(finalMsg);
  }

  public async testConnection(): Promise<{
    ok: boolean;
    latencyMs: number;
    toolCount: number;
    sampleMarketStatus: unknown;
    error?: string;
  }> {
    const start = Date.now();
    try {
      await this.disconnect();
      const tools = await this.listTools();
      const sample = await this.callMcpToolForUser(
        'mcp-connection-tester',
        ['PUBLIC_MARKET', 'RESEARCH_QUANT', 'PORTFOLIO_READ'],
        'get_nse_market_status',
        {}
      );
      return {
        ok: true,
        latencyMs: Date.now() - start,
        toolCount: tools.length,
        sampleMarketStatus: sample.data,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.lastError = msg;
      return {
        ok: false,
        latencyMs: Date.now() - start,
        toolCount: 0,
        sampleMarketStatus: null,
        error: msg,
      };
    }
  }

  public getStatus(): McpIntegrationStatus {
    return {
      serverName: MCP_SERVER_NAME,
      serverVersion: MCP_SERVER_VERSION,
      protocolVersion: MCP_PROTOCOL_VERSION,
      transportType: 'StreamableHTTP',
      endpointPath: '/mcp',
      serverRunning: true,
      clientConnected: this.connected,
      authMode: 'BEARER_TOKEN_SERVER_MANAGED',
      authConfigured: isMcpAuthConfigured(),
      lastConnectedIst: this.lastConnectedIst,
      lastToolInvocationIst: this.lastToolInvocationIst,
      lastError: this.lastError,
      tools: MCP_TOOLS_CATALOG,
      recentAuditLogs: getRecentMcpAuditLogs(30),
    };
  }
}

export const mcpClientManager = new ArthQuantMcpClientManager();
