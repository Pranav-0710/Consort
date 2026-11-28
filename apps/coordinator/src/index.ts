// The coordinator Worker: ingress for every project, plus the per-project Durable Object class.
//
// No route is reachable without authentication, and no authenticator exists until sign-in
// (#19) and pairing (#21): `authenticate` refuses everyone, so the deployed Worker writes
// nothing. Projects are created only through `init`, which #20 exposes.
import { ProjectCoordinator } from './do/project-coordinator.js';
import { handleRequest, type CoordinatorStub } from './worker/router.js';

export { ProjectCoordinator };

// The RPC stub is cast to CoordinatorStub below; this fails to compile if the object's method
// stops matching what the router calls.
type StubMatches = ProjectCoordinator['applyCommand'] extends (
  ...args: Parameters<CoordinatorStub['applyCommand']>
) => Awaited<ReturnType<CoordinatorStub['applyCommand']>>
  ? true
  : never;
const stubMatches: StubMatches = true;
void stubMatches;

interface Env {
  readonly PROJECT_COORDINATOR: DurableObjectNamespace<ProjectCoordinator>;
}

export default {
  fetch(request, env): Promise<Response> {
    return handleRequest(request, {
      authenticate: () => Promise.resolve(null),
      coordinatorFor: (projectId) =>
        env.PROJECT_COORDINATOR.get(
          env.PROJECT_COORDINATOR.idFromName(projectId),
        ) as unknown as CoordinatorStub,
    });
  },
} satisfies ExportedHandler<Env>;
