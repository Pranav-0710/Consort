// One SQLite-backed Durable Object per project (decision record 0001, issue #10).
//
// A thin wrapper: all logic is in CoordinatorCore, which is tested against the same SQL
// semantics. Migrations run in blockConcurrencyWhile, so no request is served before the schema
// is current. Every RPC method is synchronous end to end, so no other request can interleave
// with a mutation's checks and writes.
import { DurableObject } from 'cloudflare:workers';

import type { StoragePort } from '../db/sql.js';
import type { Principal } from '../mutations/principal.js';
import { PRODUCTION_REGISTRY } from '../mutations/production.js';

import {
  CoordinatorCore,
  type ApplyResult,
  type InitInput,
  type InitResult,
  type ReceiptResult,
  type WindowResult,
} from './core.js';

function storagePort(storage: DurableObjectStorage): StoragePort {
  return {
    sql: storage.sql,
    transactionSync: (fn) => storage.transactionSync(fn),
  };
}

export class ProjectCoordinator extends DurableObject {
  readonly #core: CoordinatorCore;

  constructor(ctx: DurableObjectState, env: Cloudflare.Env) {
    super(ctx, env);
    this.#core = new CoordinatorCore(storagePort(ctx.storage), { registry: PRODUCTION_REGISTRY });
    void ctx.blockConcurrencyWhile(async () => {
      this.#core.start();
    });
  }

  /** Creates the project. Called only by the project-creation route (#20). */
  init(input: InitInput): InitResult {
    // The Worker addresses each project's object by its ID, so the two must agree: a project
    // can never be created inside another project's object.
    const name = this.ctx.id.name;
    if (name !== undefined && name !== input.project_id)
      throw new TypeError('init: wrong object for project');
    return this.#core.init(input);
  }

  /** The principal is derived by the Worker from authentication, never read from the command. */
  applyCommand(principal: Principal, commandText: string): ApplyResult {
    return this.#core.applyCommand(principal, commandText);
  }

  /** Issues a command window for the authenticated principal (#11). */
  issueCommandWindow(principal: Principal): WindowResult {
    return this.#core.issueCommandWindow(principal);
  }

  /** The principal's own receipt for a request (#11). */
  readReceipt(principal: Principal, requestId: string): ReceiptResult {
    return this.#core.readReceipt(principal, requestId);
  }
}
