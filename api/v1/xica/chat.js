/* POST /api/v1/xica/chat */
import { loadConfig } from "../../../lib/xica.js";
import { chatResponse, createLimiter } from "../../../lib/http.js";

const limiter = createLimiter({
  perMin: Number(process.env.XICA_RATE_PER_MIN) || 20,
  perDay: Number(process.env.XICA_DAILY_CAP) || 1000,
});

export default {
  fetch(request) {
    return chatResponse(request, { cfg: loadConfig(), limiter, log: console.log });
  },
};
