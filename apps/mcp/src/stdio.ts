import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { HttpInspectionApi } from './api-client';
import { createInspectionMcpServer } from './server';

// For a local MCP client (e.g. Claude Desktop, an IDE, or your own agent). In production you would
// expose this over Streamable HTTP behind Entra ID and pass the user's token through.
const api = new HttpInspectionApi(process.env.IC_API_URL ?? 'http://localhost:3000', process.env.IC_API_TOKEN);
await createInspectionMcpServer(api).connect(new StdioServerTransport());
