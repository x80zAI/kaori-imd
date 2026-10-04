import { allowanceService } from '../server/allowance.mjs';
import { createApiHandler } from '../server/http.mjs';
export default createApiHandler('allowance', allowanceService);
