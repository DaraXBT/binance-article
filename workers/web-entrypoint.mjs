import openNextWorker from '../.open-next/worker.js';

import { createCutoverMaintenanceResponse } from '../server/http/cutover-maintenance.ts';

export {
  BucketCachePurge,
  DOQueueHandler,
  DOShardedTagCache,
} from '../.open-next/worker.js';

const webEntrypoint = {
  async fetch(request, environment, context) {
    const maintenanceResponse = createCutoverMaintenanceResponse({
      request,
      environment,
    });
    if (maintenanceResponse) return maintenanceResponse;

    return openNextWorker.fetch(request, environment, context);
  },
};

export default webEntrypoint;
