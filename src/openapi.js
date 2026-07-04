/**
 * OpenAPI 3.0 specification for the DettyPot backend.
 * Served as interactive Swagger UI at /docs and as raw JSON at /openapi.json.
 *
 * All monetary amounts are in KOBO (integer) — ₦1 = 100 kobo.
 */
module.exports = {
  openapi: '3.0.3',
  info: {
    title: 'DettyPot API',
    version: '0.1.0',
    description:
      'Digital ajo with receipts — a group-contribution pot engine on Nomba virtual accounts. ' +
      'Each member funds a dedicated virtual account; inbound payments auto-reconcile into one ' +
      'shared pot via signed webhooks. **All amounts are in kobo (₦1 = 100 kobo).**',
    contact: { name: 'Team Fundr', url: 'https://github.com/Niklaus-IAN/Fundr' },
  },
  servers: [
    { url: 'https://dettypot.onrender.com', description: 'Production (Render)' },
    { url: 'http://localhost:3000', description: 'Local' },
  ],
  tags: [
    { name: 'Pots', description: 'Create and read group-contribution pots' },
    { name: 'Webhooks', description: 'Nomba payment notifications' },
    { name: 'System', description: 'Service health' },
  ],
  paths: {
    '/pots': {
      post: {
        tags: ['Pots'],
        summary: 'Create a pot and provision a virtual account per member',
        description:
          'Creates a pot, splits the target across members (equal or custom), and provisions one ' +
          'dedicated Nomba virtual account (NUBAN) per member. The NUBAN→member mapping is stored ' +
          'so inbound payments reconcile automatically.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/CreatePotRequest' },
              examples: {
                equalSplit: {
                  summary: 'Equal split across 3 members',
                  value: {
                    title: 'Detty December Owambe',
                    target: 900000,
                    deadline: '2026-12-20',
                    splitMode: 'equal',
                    members: [{ name: 'Ada' }, { name: 'Bola' }, { name: 'Chidi' }],
                  },
                },
                customSplit: {
                  summary: 'Custom per-member amounts (must sum to target)',
                  value: {
                    title: 'Shared Rent',
                    target: 1000000,
                    splitMode: 'custom',
                    members: [
                      { name: 'Ada', owed: 600000 },
                      { name: 'Bola', owed: 400000 },
                    ],
                  },
                },
              },
            },
          },
        },
        responses: {
          201: {
            description: 'Pot created; VAs provisioned',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/CreatePotResponse' },
                example: {
                  potId: 'a1b2c3d4-...',
                  title: 'Detty December Owambe',
                  target: 900000,
                  members: [
                    { memberId: 'm1-...', name: 'Ada', owed: 300000, nuban: '3116169739' },
                    { memberId: 'm2-...', name: 'Bola', owed: 300000, nuban: '3571421355' },
                  ],
                },
              },
            },
          },
          400: {
            description: 'Validation error',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/Error' },
                example: { error: 'title, target and members are required' },
              },
            },
          },
        },
      },
    },
    '/pots/{id}': {
      get: {
        tags: ['Pots'],
        summary: 'Live pot dashboard data',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: 'Pot id' },
        ],
        responses: {
          200: {
            description: 'Pot with live progress and per-member status',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/PotDashboard' },
                example: {
                  id: 'a1b2c3d4-...',
                  title: 'Detty December Owambe',
                  target: 900000,
                  status: 'open',
                  collected: 300000,
                  progress: 33,
                  members: [
                    { id: 'm1-...', name: 'Ada', owed: 300000, paid: 300000, refunded: 0, status: 'active', nuban: '3116169739', remaining: 0 },
                  ],
                },
              },
            },
          },
          404: {
            description: 'Pot not found',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' }, example: { error: 'not found' } } },
          },
        },
      },
    },
    '/webhooks/nomba': {
      post: {
        tags: ['Webhooks'],
        summary: 'Nomba payment webhook receiver',
        description:
          'Receives Nomba events. ACKs immediately (Nomba has a 60s gateway timeout), then reconciles ' +
          '`payment_success` events: receiving VA → member → append-only ledger, idempotent on the ' +
          'transaction id. The `nomba-signature` header is verified (HMAC-SHA256 over specific fields). ' +
          'When signature enforcement is on, invalid signatures are rejected with 401.',
        parameters: [
          { name: 'nomba-signature', in: 'header', schema: { type: 'string' }, description: 'Base64 HMAC-SHA256 signature' },
          { name: 'nomba-signature-algorithm', in: 'header', schema: { type: 'string', example: 'HmacSHA256' } },
          { name: 'nomba-timestamp', in: 'header', schema: { type: 'string', format: 'date-time' } },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/NombaWebhook' },
              example: {
                event_type: 'payment_success',
                requestId: '49e11b44-909b-4f83-82b4-9a83a000000',
                data: {
                  merchant: { userId: '613bb620-...', walletId: '693e907a...' },
                  transaction: {
                    transactionId: 'API-VACT_TRA-...',
                    type: 'vact_transfer',
                    time: '2026-07-04T10:21:56Z',
                    responseCode: '',
                    transactionAmount: 2500,
                    aliasAccountNumber: '3116169739',
                    aliasAccountType: 'VIRTUAL',
                  },
                },
              },
            },
          },
        },
        responses: {
          200: { description: 'Acknowledged', content: { 'application/json': { schema: { type: 'object', properties: { received: { type: 'boolean' } } }, example: { received: true } } } },
          401: { description: 'Invalid signature (when enforcement is enabled)', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' }, example: { error: 'invalid signature' } } } },
        },
      },
    },
    '/health': {
      get: {
        tags: ['System'],
        summary: 'Liveness check',
        responses: {
          200: { description: 'Service is up', content: { 'application/json': { schema: { type: 'object', properties: { ok: { type: 'boolean' }, service: { type: 'string' } } }, example: { ok: true, service: 'dettypot' } } } },
        },
      },
    },
  },
  components: {
    schemas: {
      CreatePotRequest: {
        type: 'object',
        required: ['title', 'target', 'members'],
        properties: {
          title: { type: 'string', example: 'Detty December Owambe' },
          target: { type: 'integer', description: 'Target amount in kobo', example: 900000 },
          deadline: { type: 'string', nullable: true, example: '2026-12-20' },
          splitMode: { type: 'string', enum: ['equal', 'custom'], default: 'equal' },
          strictMode: { type: 'boolean', description: 'Set expectedAmount on each VA to reject mismatched payments', default: false },
          members: {
            type: 'array', minItems: 1,
            items: {
              type: 'object', required: ['name'],
              properties: {
                name: { type: 'string', example: 'Ada' },
                phone: { type: 'string', nullable: true },
                owed: { type: 'integer', description: 'Required in custom split mode (kobo)' },
              },
            },
          },
        },
      },
      CreatePotResponse: {
        type: 'object',
        properties: {
          potId: { type: 'string' },
          title: { type: 'string' },
          target: { type: 'integer' },
          members: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                memberId: { type: 'string' },
                name: { type: 'string' },
                owed: { type: 'integer' },
                nuban: { type: 'string', nullable: true, description: 'Dedicated virtual account number' },
              },
            },
          },
        },
      },
      PotDashboard: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          title: { type: 'string' },
          target: { type: 'integer' },
          deadline: { type: 'string', nullable: true },
          split_mode: { type: 'string' },
          status: { type: 'string', enum: ['open', 'funded', 'paid_out', 'cancelled'] },
          collected: { type: 'integer', description: 'Total collected (kobo), from the append-only ledger' },
          progress: { type: 'integer', description: 'Percent of target, 0–100' },
          members: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                name: { type: 'string' },
                owed: { type: 'integer' },
                paid: { type: 'integer' },
                refunded: { type: 'integer' },
                status: { type: 'string', enum: ['active', 'dropped'] },
                nuban: { type: 'string', nullable: true },
                remaining: { type: 'integer' },
              },
            },
          },
        },
      },
      NombaWebhook: {
        type: 'object',
        properties: {
          event_type: { type: 'string', example: 'payment_success' },
          requestId: { type: 'string' },
          data: {
            type: 'object',
            properties: {
              merchant: { type: 'object', properties: { userId: { type: 'string' }, walletId: { type: 'string' } } },
              transaction: {
                type: 'object',
                properties: {
                  transactionId: { type: 'string', description: 'Idempotency key for inbound funding' },
                  type: { type: 'string', example: 'vact_transfer' },
                  time: { type: 'string' },
                  responseCode: { type: 'string' },
                  transactionAmount: { type: 'number', description: 'Amount in naira' },
                  aliasAccountNumber: { type: 'string', description: 'Receiving virtual account (NUBAN)' },
                  aliasAccountType: { type: 'string', example: 'VIRTUAL' },
                },
              },
            },
          },
        },
      },
      Error: { type: 'object', properties: { error: { type: 'string' } } },
    },
  },
};
