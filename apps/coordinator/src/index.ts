import { PROTOCOL_VERSION } from '@consort/protocol';

// Placeholder Worker. The project coordinator and mutation path arrive in #10.
export default {
  fetch(): Response {
    return Response.json({ service: 'consort-coordinator', protocol: PROTOCOL_VERSION });
  },
} satisfies ExportedHandler;
