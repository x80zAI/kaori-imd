import { ethereumService } from '../server/ethereum.mjs';
import { createApiHandler } from '../server/http.mjs';
export default createApiHandler('recent', ethereumService);
