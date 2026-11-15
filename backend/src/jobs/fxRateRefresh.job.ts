import type { FxService } from '../modules/fx/fx.service.js';
export const createFxRateRefreshJob = (fx: Pick<FxService, 'refresh'>) => async () => {
  await fx.refresh();
};
