// The OpenAPI 3.1 description of Heardex's public HTTP API, served at /openapi.json (pure: built from the same OAuth
// rules the endpoints use). The product's data is reached through the MCP server (one JSON-RPC endpoint); everything
// else here is how an agent signs the user in to it. openapi.test.ts checks it against the routes in src/app.
import { ACCESS_TTL_SECONDS, ALL_SCOPES, SCOPES } from "./agent/oauth.ts";
import { MCP_TOOLS } from "./agent-guide.ts";

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const jsonBody = (schema: object, description: string) => ({ description, content: { "application/json": { schema } } });
const oauthErrors = (codes: string) => jsonBody(ref("OAuthError"), `OAuth error (${codes}).`);

export function openApiSpec(base: string) {
  return {
    openapi: "3.1.0",
    info: {
      title: "Heardex API",
      version: "1.0.0",
      summary: "Sign in to Heardex with OAuth and read a workspace's ranked product feedback through the Heardex MCP server.",
      description: [
        "Heardex finds public posts about a software product (Reddit, Hacker News, GitHub, app store reviews and more), sorts them into bug reports, feature requests, complaints and praise, groups them into issues and ranks the issues.",
        "",
        `Agents read that data through the Heardex MCP server at ${base}/api/mcp (Streamable HTTP, JSON-RPC 2.0). It is protected by OAuth 2.1: register a public client (RFC 7591), send the user to the authorization endpoint with PKCE (S256), exchange the code for a bearer token and call the MCP server with it. There are no API keys.`,
        "",
        `MCP tools: ${MCP_TOOLS.map((t) => t.name).join(", ")}. List them with the JSON-RPC method \`tools/list\` and call one with \`tools/call\`.`,
        "",
        "Errors are JSON: OAuth endpoints answer with RFC 6749 errors (`error`, `error_description`); other endpoints with an `error` object holding `code`, `message` and `hint`.",
      ].join("\n"),
      contact: { name: "Heardex support", email: "support@heardex.com", url: `${base}/legal/contact` },
      termsOfService: `${base}/legal/terms`,
    },
    externalDocs: { description: "Heardex API and MCP server docs", url: `${base}/docs/api` },
    servers: [{ url: base }],
    tags: [
      { name: "MCP", description: "The Heardex MCP server: the product's data, for AI agents." },
      { name: "OAuth", description: "OAuth 2.1 sign-in for the MCP server." },
      { name: "Discovery", description: "Metadata documents clients read to find the endpoints." },
      { name: "Status", description: "Service health." },
    ],
    paths: {
      "/api/mcp": {
        post: {
          operationId: "callMcp",
          tags: ["MCP"],
          summary: "Send an MCP JSON-RPC request",
          description: "The Heardex MCP server (Streamable HTTP, stateless, JSON responses). Send one JSON-RPC 2.0 request: `initialize`, `tools/list` or `tools/call`. Every result is scoped to the workspace the token was issued for. Post text in results is untrusted public content.",
          security: [{ oauth2: [SCOPES.read] }, { bearerAuth: [] }],
          parameters: [
            { name: "Accept", in: "header", required: true, description: "Must accept both JSON and server-sent events.", schema: { type: "string", default: "application/json, text/event-stream" } },
          ],
          requestBody: { required: true, content: { "application/json": { schema: ref("JsonRpcRequest") } } },
          responses: {
            "200": jsonBody(ref("JsonRpcResponse"), "JSON-RPC result or error."),
            "400": jsonBody(ref("JsonRpcResponse"), "The body isn't a valid JSON-RPC request (JSON-RPC error)."),
            "406": jsonBody(ref("JsonRpcResponse"), "The Accept header doesn't allow both application/json and text/event-stream (JSON-RPC error)."),
            "401": { ...jsonBody(ref("OAuthError"), "Missing or invalid token (`invalid_token`). The WWW-Authenticate header points to the protected resource metadata."), headers: { "WWW-Authenticate": { description: "Bearer challenge with resource_metadata.", schema: { type: "string" } } } },
          },
        },
      },
      "/oauth/authorize": {
        get: {
          operationId: "authorize",
          tags: ["OAuth"],
          summary: "Ask the user to allow access",
          description: "Authorization endpoint (OAuth 2.1 authorization code with PKCE). Open it in the user's browser; they sign in to Heardex, choose a workspace and allow access, and are sent back to `redirect_uri` with a `code`.",
          parameters: [
            { name: "response_type", in: "query", required: true, description: "Always `code`.", schema: { type: "string", enum: ["code"] } },
            { name: "client_id", in: "query", required: true, description: "From client registration.", schema: { type: "string" } },
            { name: "redirect_uri", in: "query", required: true, description: "One of the client's registered redirect URIs.", schema: { type: "string", format: "uri" } },
            { name: "code_challenge", in: "query", required: true, description: "PKCE challenge: base64url SHA-256 of the verifier.", schema: { type: "string" } },
            { name: "code_challenge_method", in: "query", required: true, description: "Always `S256`.", schema: { type: "string", enum: ["S256"] } },
            { name: "scope", in: "query", required: false, description: "Space-separated scopes.", schema: { type: "string", default: SCOPES.read } },
            { name: "state", in: "query", required: false, description: "Returned unchanged with the code.", schema: { type: "string" } },
            { name: "resource", in: "query", required: false, description: "The MCP server URL (RFC 8707).", schema: { type: "string", format: "uri" } },
          ],
          responses: {
            "200": { description: "The consent page (HTML), for the user, or a page explaining what is wrong with the request.", content: { "text/html": { schema: { type: "string" } } } },
            "307": { description: "To sign in first, or back to `redirect_uri` with `code`, `state` and `iss`, or with `error`." },
          },
        },
      },
      "/api/oauth/register": {
        post: {
          operationId: "registerClient",
          tags: ["OAuth"],
          summary: "Register an OAuth client",
          description: "Dynamic client registration (RFC 7591). Public clients only (`token_endpoint_auth_method: none`). Redirect URIs must be a supported app's callback or a loopback address.",
          requestBody: { required: true, content: { "application/json": { schema: ref("ClientRegistrationRequest") } } },
          responses: {
            "201": jsonBody(ref("ClientRegistration"), "The registered client."),
            "400": oauthErrors("invalid_client_metadata, invalid_redirect_uri"),
          },
        },
      },
      "/api/oauth/token": {
        post: {
          operationId: "getToken",
          tags: ["OAuth"],
          summary: "Exchange a code or refresh token",
          description: "Token endpoint. `authorization_code` with the PKCE verifier, or `refresh_token` (refresh tokens rotate: each use returns a new one).",
          requestBody: {
            required: true,
            content: {
              "application/x-www-form-urlencoded": { schema: ref("TokenRequest") },
              "application/json": { schema: ref("TokenRequest") },
            },
          },
          responses: {
            "200": jsonBody(ref("TokenResponse"), "A bearer access token and a new refresh token."),
            "400": oauthErrors("invalid_request, invalid_grant, unsupported_grant_type"),
            "401": oauthErrors("invalid_client"),
          },
        },
      },
      "/api/oauth/revoke": {
        post: {
          operationId: "revokeToken",
          tags: ["OAuth"],
          summary: "Revoke a token",
          description: "Token revocation (RFC 7009). Revokes the grant the token belongs to. Always 200, also for unknown tokens.",
          requestBody: {
            required: true,
            content: { "application/x-www-form-urlencoded": { schema: ref("RevokeRequest") }, "application/json": { schema: ref("RevokeRequest") } },
          },
          responses: { "200": { description: "Revoked (or the token was unknown)." } },
        },
      },
      "/.well-known/oauth-authorization-server": {
        get: {
          operationId: "getAuthorizationServerMetadata",
          tags: ["Discovery"],
          summary: "Authorization server metadata",
          description: "OAuth 2.0 authorization server metadata (RFC 8414): the endpoints, grants and scopes.",
          responses: { "200": jsonBody(ref("AuthorizationServerMetadata"), "The metadata.") },
        },
      },
      "/.well-known/oauth-protected-resource": {
        get: {
          operationId: "getProtectedResourceMetadata",
          tags: ["Discovery"],
          summary: "Protected resource metadata",
          description: "OAuth 2.0 protected resource metadata (RFC 9728) for the MCP server: which authorization server issues its tokens.",
          responses: { "200": jsonBody(ref("ProtectedResourceMetadata"), "The metadata.") },
        },
      },
      "/api/health": {
        get: {
          operationId: "getHealth",
          tags: ["Status"],
          summary: "Service health",
          description: "200 when the site is up and can reach its database, 503 when it can't.",
          responses: {
            "200": jsonBody(ref("Health"), "Up."),
            "503": jsonBody(ref("Health"), "The database can't be reached."),
          },
        },
      },
    },
    components: {
      securitySchemes: {
        oauth2: {
          type: "oauth2",
          description: "OAuth 2.1 authorization code with PKCE (S256); public clients registered dynamically.",
          flows: {
            authorizationCode: {
              authorizationUrl: `${base}/oauth/authorize`,
              tokenUrl: `${base}/api/oauth/token`,
              refreshUrl: `${base}/api/oauth/token`,
              scopes: {
                [SCOPES.read]: "Read the workspace's products, issues, evidence and spikes.",
                [SCOPES.agent]: "Fetch developer-agent tasks and report their results.",
              },
            },
          },
        },
        bearerAuth: { type: "http", scheme: "bearer", description: "An access token from the token endpoint." },
      },
      schemas: {
        OAuthError: {
          type: "object",
          description: "RFC 6749 error response.",
          required: ["error"],
          properties: {
            error: { type: "string", description: "Error code, such as invalid_request, invalid_client, invalid_grant or invalid_token." },
            error_description: { type: "string", description: "What went wrong and how to fix it." },
          },
        },
        ApiError: {
          type: "object",
          description: "Error response from non-OAuth endpoints.",
          required: ["error"],
          properties: {
            error: {
              type: "object",
              required: ["code", "message"],
              properties: {
                code: { type: "string", description: "Machine-readable code, such as not_found." },
                message: { type: "string", description: "What went wrong." },
                hint: { type: "string", description: "How to fix it." },
                docs: { type: "string", format: "uri", description: "Where to read more." },
              },
            },
          },
        },
        JsonRpcRequest: {
          type: "object",
          required: ["jsonrpc", "method"],
          properties: {
            jsonrpc: { type: "string", enum: ["2.0"] },
            id: { type: ["string", "integer"], description: "Omit for notifications." },
            method: { type: "string", description: "initialize, tools/list, tools/call, or a notification.", examples: ["tools/call"] },
            params: {
              type: "object",
              description: "For tools/call: the tool's `name` and its `arguments`.",
              properties: {
                name: { type: "string", enum: MCP_TOOLS.map((t) => t.name) },
                arguments: { type: "object", additionalProperties: true },
              },
              additionalProperties: true,
            },
          },
        },
        JsonRpcResponse: {
          type: "object",
          required: ["jsonrpc"],
          properties: {
            jsonrpc: { type: "string", enum: ["2.0"] },
            id: { type: ["string", "integer", "null"] },
            result: { type: "object", additionalProperties: true, description: "For tools/call: `content` (text holding JSON) and `isError`." },
            error: {
              type: "object",
              required: ["code", "message"],
              properties: { code: { type: "integer" }, message: { type: "string" }, data: {} },
            },
          },
        },
        ClientRegistrationRequest: {
          type: "object",
          required: ["redirect_uris"],
          properties: {
            client_name: { type: "string", maxLength: 200 },
            redirect_uris: { type: "array", minItems: 1, items: { type: "string", format: "uri" } },
            grant_types: { type: "array", items: { type: "string", enum: ["authorization_code", "refresh_token"] } },
            response_types: { type: "array", items: { type: "string", enum: ["code"] } },
            token_endpoint_auth_method: { type: "string", enum: ["none"] },
          },
        },
        ClientRegistration: {
          type: "object",
          required: ["client_id", "redirect_uris"],
          properties: {
            client_id: { type: "string" },
            client_id_issued_at: { type: "integer", description: "Unix time." },
            client_name: { type: "string" },
            redirect_uris: { type: "array", items: { type: "string", format: "uri" } },
            grant_types: { type: "array", items: { type: "string" } },
            response_types: { type: "array", items: { type: "string" } },
            token_endpoint_auth_method: { type: "string", enum: ["none"] },
          },
        },
        TokenRequest: {
          type: "object",
          required: ["grant_type", "client_id"],
          properties: {
            grant_type: { type: "string", enum: ["authorization_code", "refresh_token"] },
            client_id: { type: "string" },
            code: { type: "string", description: "authorization_code only." },
            redirect_uri: { type: "string", format: "uri", description: "authorization_code only; the one used to authorize." },
            code_verifier: { type: "string", description: "authorization_code only; the PKCE verifier." },
            refresh_token: { type: "string", description: "refresh_token only." },
          },
        },
        TokenResponse: {
          type: "object",
          required: ["access_token", "token_type", "expires_in"],
          properties: {
            access_token: { type: "string" },
            token_type: { type: "string", enum: ["Bearer"] },
            expires_in: { type: "integer", description: `Seconds (${ACCESS_TTL_SECONDS}).` },
            refresh_token: { type: "string" },
            scope: { type: "string" },
          },
        },
        RevokeRequest: {
          type: "object",
          required: ["token"],
          properties: { token: { type: "string" }, token_type_hint: { type: "string", enum: ["access_token", "refresh_token"] } },
        },
        AuthorizationServerMetadata: {
          type: "object",
          required: ["issuer", "authorization_endpoint", "token_endpoint"],
          properties: {
            issuer: { type: "string", format: "uri" },
            authorization_endpoint: { type: "string", format: "uri" },
            token_endpoint: { type: "string", format: "uri" },
            registration_endpoint: { type: "string", format: "uri" },
            revocation_endpoint: { type: "string", format: "uri" },
            response_types_supported: { type: "array", items: { type: "string" } },
            grant_types_supported: { type: "array", items: { type: "string" } },
            code_challenge_methods_supported: { type: "array", items: { type: "string" } },
            token_endpoint_auth_methods_supported: { type: "array", items: { type: "string" } },
            revocation_endpoint_auth_methods_supported: { type: "array", items: { type: "string" } },
            scopes_supported: { type: "array", items: { type: "string", enum: [...ALL_SCOPES, "offline_access"] } },
          },
        },
        ProtectedResourceMetadata: {
          type: "object",
          required: ["resource", "authorization_servers"],
          properties: {
            resource: { type: "string", format: "uri" },
            authorization_servers: { type: "array", items: { type: "string", format: "uri" } },
            scopes_supported: { type: "array", items: { type: "string" } },
            bearer_methods_supported: { type: "array", items: { type: "string" } },
            resource_name: { type: "string" },
          },
        },
        Health: {
          type: "object",
          required: ["ok", "database", "ms"],
          properties: { ok: { type: "boolean" }, database: { type: "string", enum: ["up", "down"] }, ms: { type: "integer", description: "Time the check took." } },
        },
      },
    },
  };
}
