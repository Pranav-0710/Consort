// Protocol version (stress G06). A client may be older than the coordinator within one major
// version, never newer, so a coordinator never receives fields it does not understand.

export interface ProtocolVersion {
  readonly major: number;
  readonly minor: number;
}

export const PROTOCOL_VERSION: ProtocolVersion = { major: 0, minor: 1 };

/** True when a client speaking `client` can talk to a coordinator speaking `server`. */
export function isSupported(client: ProtocolVersion, server: ProtocolVersion = PROTOCOL_VERSION): boolean {
  return client.major === server.major && client.minor <= server.minor;
}
