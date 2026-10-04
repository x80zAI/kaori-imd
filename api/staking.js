import { stakingService } from '../server/staking.mjs';
import { createApiHandler } from '../server/http.mjs';
export default createApiHandler('staking', stakingService);
