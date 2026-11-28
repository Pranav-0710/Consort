// The registry the deployed coordinator uses.
//
// It is deliberately empty: membership (#20) replaces DENY_ALL with the real authority loader,
// and each issue that owns a record type adds its handlers here. Until then every command is
// refused, and the Worker authenticates nobody, so nothing can be written in production.
import { createRegistry, DENY_ALL } from './registry.js';

export const PRODUCTION_REGISTRY = createRegistry({ authority: DENY_ALL, handlers: [] });
